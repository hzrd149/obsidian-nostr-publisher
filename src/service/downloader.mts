import { kinds, Event as NostrEvent } from "nostr-tools";
import { App, Notice, TFile } from "obsidian";
import { firstValueFrom } from "rxjs";
import { mergeRelaySets } from "applesauce-core/helpers";
import { AddressPointer, ProfilePointer } from "nostr-tools/nip19";

import NostrArticlesPlugin from "../../main.mjs";
import {
  extractNostrArticleFrontmatter,
  generateImageFilename,
} from "../helpers/articles.mjs";
import { getAddressPointerFromInput } from "../helpers/nip19.mjs";
import { NostrFrontmatter } from "../schema/frontmatter.mjs";
import { fetchLatestEvents } from "./fetcher.mjs";

export default class Downloader {
  constructor(
    private readonly app: App,
    private readonly plugin: NostrArticlesPlugin,
  ) {}

  /**
   * Downloads a single article by AddressPointer or address
   * @param address An AddressPointer, naddr1..., or URL containing a reference to a Nostr article
   * @returns The saved file
   */
  async downloadArticle(address: string): Promise<TFile> {
    // Parse the input to extract the event ID
    const pointer = getAddressPointerFromInput(address);
    if (!pointer) throw new Error("Invalid nostr address or URL");

    // Fetch the article event
    const event = await this.fetchArticleEvent(pointer);
    if (!event) {
      throw new Error("Failed to fetch article");
    }

    // Process and save the article
    return await this.processAndSaveArticle(event);
  }

  /**
   * Downloads all articles by an author
   * @param pointer The nostr ProfilePointer
   * @returns Array of saved files
   */
  async downloadAuthorArticles(pointer: ProfilePointer): Promise<TFile[]> {
    // Fetch all articles by the author
    const events = await this.fetchAuthorArticles(pointer);
    if (!events || events.length === 0) {
      throw new Error("No articles found for this author");
    }

    // Process and save each article
    const savedFiles: TFile[] = [];
    for (const event of events) {
      try {
        const file = await this.processAndSaveArticle(event);
        savedFiles.push(file);
      } catch (error) {
        console.error(`Failed to save article ${event.id}:`, error);
        // Continue with the next article
      }
    }

    return savedFiles;
  }

  /**
   * Fetches a Nostr article event by its ID
   * @param pointer The nostr AddressPointer
   * @returns The Nostr event
   */
  private async fetchArticleEvent(
    pointer: AddressPointer,
  ): Promise<NostrEvent | null> {
    const publishRelays = await firstValueFrom(this.plugin.publishRelays);
    const localRelay = await firstValueFrom(this.plugin.localRelay);

    const relays: string[] = mergeRelaySets(pointer.relays, publishRelays, [
      localRelay,
    ]);

    if (relays.length === 0) {
      throw new Error("No relays configured");
    }

    const group = this.plugin.pool.group(relays);
    const loaded = await fetchLatestEvents(group, {
      kinds: [pointer.kind],
      authors: [pointer.pubkey],
      "#d": [pointer.identifier],
    });

    // Deduplicate events by adding them to the event store
    for (const event of loaded) this.plugin.events.add(event);

    return (
      this.plugin.events.getReplaceable(
        pointer.kind,
        pointer.pubkey,
        pointer.identifier,
      ) ?? null
    );
  }

  /**
   * Fetches all articles by an author
   * @param pointer The nostr ProfilePointer
   * @returns Array of Nostr events
   */
  private async fetchAuthorArticles(
    pointer: ProfilePointer,
  ): Promise<NostrEvent[]> {
    const publishRelays = await firstValueFrom(this.plugin.publishRelays);
    const localRelay = await firstValueFrom(this.plugin.localRelay);

    const relays: string[] = mergeRelaySets(pointer.relays, publishRelays, [
      localRelay,
    ]);

    if (relays.length === 0) {
      throw new Error("No relays configured");
    }

    const group = this.plugin.pool.group(relays);

    const loaded = await fetchLatestEvents(group, {
      authors: [pointer.pubkey],
      kinds: [kinds.LongFormArticle],
    });

    // Deduplicate events by adding them to the event store
    for (const event of loaded) this.plugin.events.add(event);

    // Get events from the event store
    const events = this.plugin.events.getByFilters({
      authors: [pointer.pubkey],
      kinds: [kinds.LongFormArticle],
    });

    return Array.from(events);
  }

  /**
   * Processes a Nostr article event and saves it to the vault
   * @param event The Nostr event
   * @returns The saved file
   */
  private async processAndSaveArticle(event: NostrEvent): Promise<TFile> {
    // Extract metadata from the event
    const frontmatter = extractNostrArticleFrontmatter(event);

    // Generate a filename from the title
    const filename = `${frontmatter.title}.md`;

    // Process the article content
    let content = event.content;

    // Download and replace any images
    content = await this.processImages(content);

    // Combine everything into markdown
    const markdown = this.createMarkdown(frontmatter, content);

    // Save the file to the vault
    return await this.saveToVault(filename, markdown);
  }

  /**
   * Processes and downloads images in the article content
   * @param content The article content
   * @returns The content with updated image paths
   */
  private async processImages(content: string): Promise<string> {
    // Get the configured image download folder
    const imageDownloadFolder =
      this.plugin.data.value.mediaDownloadFolder || "media";

    // Create the folder if it doesn't exist
    await this.ensureFolderExists(imageDownloadFolder);

    // Regular expression to find image markdown
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;

    // Process all images in the content
    let match;
    let processedContent = content;

    while ((match = imageRegex.exec(content)) !== null) {
      const [fullMatch, altText, imageUrl] = match;

      try {
        // Download the image and get the local path
        const localPath = await this.downloadImage(
          imageUrl,
          imageDownloadFolder,
        );

        // Replace the image URL with the local path
        processedContent = processedContent.replace(
          fullMatch,
          `![${altText}](${localPath})`,
        );
      } catch (error) {
        console.error(`Failed to download image ${imageUrl}:`, error);
        // Keep the original URL if download fails
      }
    }

    return processedContent;
  }

  /**
   * Creates markdown with frontmatter and content
   * @param frontmatter The article frontmatter
   * @param content The article content
   * @returns Complete markdown string
   */
  private createMarkdown(
    frontmatter: NostrFrontmatter,
    content: string,
  ): string {
    // Convert frontmatter to YAML
    const yamlLines = [
      "---",
      ...Object.entries(frontmatter).map(([key, value]) => {
        if (Array.isArray(value)) {
          return `${key}:\n${value.map((v) => `  - ${v}`).join("\n")}`;
        } else {
          return `${key}: ${JSON.stringify(value)}`;
        }
      }),
      "---",
      "",
    ];

    return yamlLines.join("\n") + content;
  }

  /**
   * Downloads an image and returns its local path
   * @param url The image URL
   * @param folder The folder to save the image to
   * @returns The local path to the image
   */
  private async downloadImage(url: string, folder: string): Promise<string> {
    try {
      // Generate a unique filename based on the URL
      const filename = generateImageFilename(url);
      const fullPath = `${folder}/${filename}`;

      // Fetch the image
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      // Convert to ArrayBuffer
      const buffer = await response.arrayBuffer();

      // Save to the vault
      const adapter = this.app.vault.adapter;
      await adapter.mkdir(folder); // Ensure the folder exists
      await adapter.writeBinary(fullPath, buffer);

      return fullPath;
    } catch (error) {
      console.error(`Failed to download image ${url}:`, error);
      throw error;
    }
  }

  /**
   * Ensures a folder exists in the vault
   * @param folderPath The folder path
   */
  private async ensureFolderExists(folderPath: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const folders = folderPath.split("/");
    let currentPath = "";

    for (const folder of folders) {
      if (!folder) continue;

      currentPath += folder + "/";
      if (!(await adapter.exists(currentPath))) {
        await adapter.mkdir(currentPath);
      }
    }
  }

  /**
   * Saves a markdown file to the vault
   * @param filename The filename
   * @param content The markdown content
   * @returns The saved file
   */
  private async saveToVault(filename: string, content: string): Promise<TFile> {
    // Check if file already exists
    const adapter = this.app.vault.adapter;
    let finalFilename = filename;
    let counter = 1;

    // Ensure we don't overwrite existing files
    while (await adapter.exists(finalFilename)) {
      const extension = filename.endsWith(".md") ? ".md" : "";
      const baseName = filename.replace(/\.md$/, "");
      finalFilename = `${baseName}-${counter}${extension}`;
      counter++;
    }

    // Create the file
    return await this.app.vault.create(finalFilename, content);
  }
}
