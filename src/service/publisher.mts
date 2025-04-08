import { App, EmbedCache, TFile } from "obsidian";
import { firstValueFrom, lastValueFrom, toArray } from "rxjs";
import { AddressPointer } from "nostr-tools/nip19";
import { EventTemplate, kinds, NostrEvent, UnsignedEvent } from "nostr-tools";
import {
  includeHashtags,
  includeSingletonTag,
  setContent,
} from "applesauce-factory/operations/event";
import { PublishResponse } from "applesauce-relay";
import { BlobDescriptor, BlossomClient } from "blossom-client-sdk";
import { multiServerUpload } from "blossom-client-sdk/actions/multi-server";

import { normalizePubkey } from "../helpers/nip19.mjs";
import NostrArticlesPlugin from "../../main.mjs";
import { NostrFrontmatter } from "../schema/frontmatter.mjs";
import { UPLOAD_MEDIA_EXT } from "../const.mjs";

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

  /** Gets the markdown content of a file without the frontmatter */
  async getArticleContent(
    file: TFile,
    uploads: Iterable<[EmbedCache, BlobDescriptor]>,
  ) {
    let content = await this.app.vault.read(file);

    const frontmatterRegex = /---\s*[\s\S]*?\s*---/g;
    content = content.replace(frontmatterRegex, "").trim();

    content = this.replaceEmbedsWithBlobs(content, uploads);

    return content;
  }

  /** Processes a file into an unsigned nostr article */
  async createArticleDraft(
    file: TFile,
    uploads: Iterable<[EmbedCache, BlobDescriptor]>,
  ): Promise<UnsignedEvent> {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) throw new Error("File has no frontmatter");

    const { title, summary, image, tags, pubkey, identifier, published_at } =
      frontmatter as NostrFrontmatter;

    if (!identifier || !pubkey)
      throw new Error("File missing identifier or pubkey");

    let draft: EventTemplate;
    const content = await this.getArticleContent(file, uploads);

    const existing = this.plugin.events.getReplaceable(
      kinds.LongFormArticle,
      pubkey,
      identifier,
    );

    const operations = [
      setContent(content),
      title ? includeSingletonTag(["title", title], true) : undefined,
      summary ? includeSingletonTag(["summary", summary], true) : undefined,
      image ? includeSingletonTag(["image", image], true) : undefined,
      tags ? includeHashtags(tags) : undefined,
      published_at
        ? includeSingletonTag(["published_at", String(published_at)], true)
        : undefined,
    ];

    if (existing)
      draft = await this.plugin.factory.modify(existing, ...operations);
    else
      draft = await this.plugin.factory.build(
        { kind: kinds.LongFormArticle },
        includeSingletonTag(["d", identifier]),
        ...operations,
      );

    return await this.plugin.factory.stamp(draft);
  }

  /** Signs an article draft */
  async signArticleDraft(draft: UnsignedEvent): Promise<NostrEvent> {
    return await this.plugin.factory.sign(draft);
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

    const uploads = await multiServerUpload(servers, blob, {
      // explicitly disable any media modifications
      isMedia: false,
      onAuth: async (_server, sha256) => {
        return await BlossomClient.createUploadAuth(
          async (draft) => this.plugin.accounts.signer.signEvent(draft),
          sha256,
        );
      },
    });

    // return the first upload that is successful
    for (const server of servers) {
      const upload = uploads.get(server);
      if (upload) return upload;
    }

    throw new Error("Failed to upload media");
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
}
