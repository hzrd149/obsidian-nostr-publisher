import { EventFactory } from "applesauce-core/factories";
import { PublishResponse } from "applesauce-relay";
import {
  BlobDescriptor,
  BlossomClient,
  encodeAuthorizationHeader,
  getBlobSha256,
} from "blossom-client-sdk";
import { kinds, NostrEvent, UnsignedEvent } from "nostr-tools";
import { AddressPointer } from "nostr-tools/nip19";
import {
  App,
  EmbedCache,
  TFile,
  getLinkpath,
  parseLinktext,
  requestUrl,
} from "obsidian";
import { firstValueFrom, lastValueFrom, toArray } from "rxjs";

import NostrArticlesPlugin from "../../main.mjs";
import { MIME_TYPES, UPLOAD_MEDIA_EXT } from "../const.mjs";
import { normalizePubkey } from "../helpers/nip19.mjs";
import { NostrFrontmatter } from "../schema/frontmatter.mjs";

export default class Publisher {
  constructor(
    private readonly app: App,
    private readonly plugin: NostrArticlesPlugin,
  ) {}

  /** Returns an AddressPointer if a file has been published as an article */
  getArticleNostrAddress(file: TFile): AddressPointer | null {
    if (file.extension !== "md") return null;

    const frontmatter = this.app.metadataCache.getFileCache(file)
      ?.frontmatter as NostrFrontmatter | undefined;
    if (!frontmatter || !frontmatter.pubkey || !frontmatter.identifier)
      return null;

    const pubkey = normalizePubkey(frontmatter.pubkey);
    const identifier = frontmatter.identifier;

    if (!pubkey) return null;

    const pointer: AddressPointer = {
      pubkey,
      identifier,
      kind: kinds.LongFormArticle,
    };

    return pointer;
  }

  /** Returns an array of embedded media that should be uploaded with the article */
  getArticleEmbeddedMedia(file: TFile): EmbedCache[] | null {
    const embeds = this.app.metadataCache.getFileCache(file)?.embeds;
    if (!embeds) return null;

    return embeds.filter((embed) =>
      UPLOAD_MEDIA_EXT.some((ext) => embed.link.endsWith(ext)),
    );
  }

  /**
   * Gets processed content with wikilinks converted to images/markdown links
   * This processes content in memory without modifying the vault
   */
  async getProcessedContent(file: TFile): Promise<string> {
    // Read the file content
    let content = await this.app.vault.read(file);

    // Remove frontmatter
    const frontmatterRegex = /^---[\s|\S]*\n---\n/;
    content = content.replace(frontmatterRegex, "").trim();

    // Process wikilinks that point to images
    content = this.processImageWikilinks(content, file);

    return content;
  }

  /**
   * Gets embedded media from processed content (includes converted image wikilinks)
   * This works with content that has wikilinks converted to markdown images
   */
  getEmbeddedMediaFromContent(content: string, file: TFile): EmbedCache[] {
    // Find all markdown images in the processed content
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const embeds: EmbedCache[] = [];
    let match;

    while ((match = imageRegex.exec(content)) !== null) {
      const [fullMatch, altText, imagePath] = match;

      // Check if this is a local image file
      const imageFile = this.app.metadataCache.getFirstLinkpathDest(
        imagePath,
        file.path,
      );

      if (
        imageFile &&
        UPLOAD_MEDIA_EXT.some(
          (ext) => imageFile.extension.toLowerCase() === ext.substring(1),
        )
      ) {
        // Create a mock EmbedCache for the image
        const embed: EmbedCache = {
          link: imagePath,
          displayText: altText,
          original: fullMatch,
          position: {
            start: { line: 0, col: 0, offset: match.index },
            end: { line: 0, col: 0, offset: match.index + fullMatch.length },
          },
        };
        embeds.push(embed);
      }
    }

    return embeds;
  }

  /**
   * Converts wikilinks that point to images into markdown image syntax
   * Handles both regular wikilinks [[file]] and image wikilinks ![[file]]
   * @param content The content to process
   * @param sourceFile The source file for resolving relative paths
   * @returns Content with image wikilinks converted to markdown images
   */
  private processImageWikilinks(content: string, sourceFile: TFile): string {
    // Regular expression to match both regular wikilinks and image wikilinks
    // Matches: [[link|display text]] or [[link]] or ![[link|display text]] or ![[link]]
    const wikilinkRegex = /(!?)\[\[([^\]]+)\]\]/g;

    return content.replace(wikilinkRegex, (match, imagePrefix, linkText) => {
      try {
        // Check if the link has display text (format: "path|display text")
        const parts = linkText.split("|");
        const linkPath = parts[0].trim();
        const displayText = parts[1]?.trim();

        // Parse the link text to extract path and subpath
        const { path, subpath } = parseLinktext(linkPath);

        // Get the actual file path
        const linkpath = getLinkpath(path);

        // Try to find the target file
        const targetFile = this.app.metadataCache.getFirstLinkpathDest(
          linkpath,
          sourceFile.path,
        );

        if (targetFile) {
          // Check if the target file is an image
          const isImage = UPLOAD_MEDIA_EXT.some(
            (ext) => targetFile.extension.toLowerCase() === ext.substring(1),
          );

          // If it's an image wikilink (![[file]]) or if the file is actually an image
          if (imagePrefix === "!" || isImage) {
            // Convert to markdown image syntax
            const altText = displayText || targetFile.basename;
            return `![${altText}](${targetFile.path})`;
          } else {
            // For non-image files, convert to markdown link
            const finalDisplayText = displayText || targetFile.basename;
            return `[${finalDisplayText}](${targetFile.path})`;
          }
        } else {
          // If file not found, convert to plain text
          return displayText || linkPath;
        }
      } catch (error) {
        console.warn(`Failed to process wikilink ${match}:`, error);
        // If processing fails, return the original link text without brackets
        return linkText.split("|")[0] || linkText;
      }
    });
  }

  /** Gets the markdown content of a file without the frontmatter */
  async getArticleContent(
    file: TFile,
    uploads: Iterable<[EmbedCache, BlobDescriptor]>,
    processedContent?: string,
  ) {
    // Use processed content if provided, otherwise read from vault
    let content = processedContent || (await this.app.vault.read(file));

    // If we don't have processed content, remove frontmatter
    if (!processedContent) {
      const frontmatterRegex = /^---[\s|\S]*\n---\n/;
      content = content.replace(frontmatterRegex, "").trim();
    }

    // Process uploads (no position adjustment needed since we're working with processed content)
    content = this.replaceEmbedsWithBlobs(content, uploads);

    // Process any remaining wikilinks
    content = this.processWikilinks(content, file);

    return content;
  }

  /** Processes a file into an unsigned nostr article */
  async createArticleDraft(
    file: TFile,
    uploads: Iterable<[EmbedCache, BlobDescriptor]>,
    processedContent?: string,
  ): Promise<UnsignedEvent> {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) throw new Error("File has no frontmatter");

    const { title, summary, image, tags, pubkey, identifier, published_at } =
      frontmatter as NostrFrontmatter;

    if (!identifier || !pubkey)
      throw new Error("File missing identifier or pubkey");

    const content = await this.getArticleContent(
      file,
      uploads,
      processedContent,
    );

    const existing = this.plugin.events.getReplaceable(
      kinds.LongFormArticle,
      pubkey,
      identifier,
    );

    // applesauce v6 uses the Promise-based fluent EventFactory. There is no
    // dedicated article factory, so build/modify the kind 30023 event with the
    // base factory: `fromEvent` to update an existing article (refreshes
    // created_at) or `fromKind` for a new one.
    const base = existing
      ? EventFactory.fromEvent(existing)
      : EventFactory.fromKind(kinds.LongFormArticle);

    // Tags we fully own and re-derive from the note's frontmatter on every
    // publish. Everything else on an existing event is preserved.
    const managed = new Set([
      "d",
      "title",
      "summary",
      "image",
      "published_at",
      "t",
      "client",
    ]);

    const draft = await base
      .content(content)
      .modifyPublicTags((current) => {
        const next = current.filter((tag) => !managed.has(tag[0]));

        next.push(["d", identifier]);
        if (title) next.push(["title", title]);
        if (summary) next.push(["summary", summary]);
        if (image) next.push(["image", image]);
        if (published_at) next.push(["published_at", String(published_at)]);
        for (const tag of tags ?? []) next.push(["t", tag]);
        next.push(["client", "Obsidian Nostr publisher"]);

        return next;
      })
      .stamp(this.plugin.accounts.signer);

    return draft;
  }

  /** Signs an article draft */
  async signArticleDraft(draft: UnsignedEvent): Promise<NostrEvent> {
    return await this.plugin.accounts.signer.signEvent(draft);
  }

  /** Publishes an article to the outbox relays */
  async publishArticle(event: NostrEvent): Promise<PublishResponse[]> {
    const account = this.plugin.accounts.getAccountForPubkey(event.pubkey);
    if (!account) throw new Error("Cant find account for pubkey");

    const relays = await firstValueFrom(this.plugin.mailboxes);
    if (!relays) throw new Error("No relays found");

    return await lastValueFrom(
      this.plugin.pool.event(relays.outboxes, event).pipe(toArray()),
    );
  }

  async uploadMediaEmbed(
    article: TFile,
    media: EmbedCache,
    servers: string[],
  ): Promise<BlobDescriptor> {
    const file = this.app.metadataCache.getFirstLinkpathDest(
      media.link,
      article.path,
    );
    if (!file) throw new Error("Cant find file");

    const buffer = await this.app.vault.readBinary(file);
    const blob = new Blob([buffer]);
    const sha256 = await getBlobSha256(blob);
    const contentType = MIME_TYPES[file.extension.toLowerCase()];

    // Create a single upload auth event; it is bound to the blob hash (the "x"
    // tag) so it can be reused across every server.
    const auth = await BlossomClient.createUploadAuth(
      async (draft) => this.plugin.accounts.signer.signEvent(draft),
      sha256,
    );
    const authorization = encodeAuthorizationHeader(auth);

    // Upload via Obsidian's requestUrl rather than the SDK's fetch-based
    // multiServerUpload: requestUrl issues the request from the Node side and
    // is not subject to the browser CORS policy that blocks app://obsidian.md.
    const errors: string[] = [];
    for (const server of servers) {
      try {
        const url = new URL("/upload", server).toString();
        const headers: Record<string, string> = {
          "X-SHA-256": sha256,
          Authorization: authorization,
        };
        if (contentType) headers["Content-Type"] = contentType;

        const response = await requestUrl({
          url,
          method: "PUT",
          body: buffer,
          headers,
          throw: false,
        });

        if (response.status >= 200 && response.status < 300) {
          return response.json as BlobDescriptor;
        }

        errors.push(`${server}: ${response.status} ${response.text}`);
      } catch (err) {
        errors.push(`${server}: ${err instanceof Error ? err.message : err}`);
      }
    }

    throw new Error(`Failed to upload media. ${errors.join("; ")}`);
  }

  replaceEmbedsWithBlobs(
    content: string,
    uploads: Iterable<[EmbedCache, BlobDescriptor]>,
  ): string {
    const sorted = Array.from(uploads)
      .map(([embed, blob]) => ({ embed, blob }))
      .sort(
        (a, b) => a.embed.position.start.offset - b.embed.position.start.offset,
      );

    // Process embeds in reverse order to preserve positions
    return sorted.reduceRight((text, { embed, blob }) => {
      const before = text.slice(0, embed.position.start.offset);
      const after = text.slice(embed.position.end.offset);
      return (
        before +
        (embed.displayText
          ? `![${embed.displayText}](${blob.url})`
          : `![](${blob.url})`) +
        after
      );
    }, content);
  }

  /**
   * Converts remaining Obsidian wikilinks [[]] to standard markdown links
   * Handles both regular wikilinks [[file]] and image wikilinks ![[file]]
   * This processes non-image wikilinks that weren't converted in preprocessing
   * @param content The content to process
   * @param sourceFile The source file for resolving relative paths
   * @returns Content with wikilinks converted to markdown links
   */
  processWikilinks(content: string, sourceFile: TFile): string {
    // Regular expression to match both regular wikilinks and image wikilinks
    // Matches: [[link|display text]] or [[link]] or ![[link|display text]] or ![[link]]
    const wikilinkRegex = /(!?)\[\[([^\]]+)\]\]/g;

    return content.replace(wikilinkRegex, (match, imagePrefix, linkText) => {
      try {
        // Check if the link has display text (format: "path|display text")
        const parts = linkText.split("|");
        const linkPath = parts[0].trim();
        const displayText = parts[1]?.trim();

        // Parse the link text to extract path and subpath
        const { path, subpath } = parseLinktext(linkPath);

        // Get the actual file path
        const linkpath = getLinkpath(path);

        // Try to find the target file
        const targetFile = this.app.metadataCache.getFirstLinkpathDest(
          linkpath,
          sourceFile.path,
        );

        if (targetFile) {
          // Check if the target file is an image
          const isImage = UPLOAD_MEDIA_EXT.some(
            (ext) => targetFile.extension.toLowerCase() === ext.substring(1),
          );

          // If it's an image wikilink (![[file]]) or if the file is actually an image
          if (imagePrefix === "!" || isImage) {
            // Convert to markdown image syntax
            const altText = displayText || targetFile.basename;
            return `![${altText}](${targetFile.path})`;
          } else {
            // Determine the display text for regular links
            let finalDisplayText: string;
            if (displayText) {
              // Use the provided display text
              finalDisplayText = subpath
                ? `${displayText}#${subpath}`
                : displayText;
            } else {
              // Use the file name as display text
              finalDisplayText = subpath
                ? `${targetFile.basename}#${subpath}`
                : targetFile.basename;
            }

            // Create a markdown link
            // For now, we'll use the file path as the URL
            // In the future, this could be enhanced to use naddr1 links for Nostr articles
            return `[${finalDisplayText}](${targetFile.path})`;
          }
        } else {
          // If file not found, convert to plain text with the original link text
          return displayText || linkPath;
        }
      } catch (error) {
        console.warn(`Failed to process wikilink ${match}:`, error);
        // If processing fails, return the original link text without brackets
        return linkText.split("|")[0] || linkText;
      }
    });
  }
}
