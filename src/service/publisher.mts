import { App, TFile } from "obsidian";
import { firstValueFrom, lastValueFrom, toArray } from "rxjs";
import { AddressPointer } from "nostr-tools/nip19";
import { EventTemplate, kinds, NostrEvent, UnsignedEvent } from "nostr-tools";
import {
  includeHashtags,
  includeSingletonTag,
  setContent,
} from "applesauce-factory/operations/event";
import { PublishResponse } from "applesauce-relay";

import { normalizePubkey } from "../helpers/nip19.mjs";
import NostrArticlesPlugin from "../../main.mjs";
import { NostrFrontmatter } from "../schema/frontmatter.mjs";

export default class Publisher {
  constructor(
    private readonly app: App,
    private readonly plugin: NostrArticlesPlugin,
  ) {}

  /** Returns an AddressPointer if a file has been published as an article */
  getArticleNostrAddress(file: TFile): AddressPointer | null {
    if (file.extension !== "md") return null;

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) return null;

    const pubkey = normalizePubkey(frontmatter.pubkey);
    const identifier = frontmatter.identifier;

    if (!pubkey || !identifier) return null;

    const pointer: AddressPointer = {
      pubkey,
      identifier,
      kind: kinds.LongFormArticle,
    };

    return pointer;
  }

  /** Gets the markdown content of a file without the frontmatter */
  async getArticleContent(file: TFile) {
    let content = await this.app.vault.read(file);

    const frontmatterRegex = /---\s*[\s\S]*?\s*---/g;
    content = content.replace(frontmatterRegex, "").trim();

    return content;
  }

  /** Processes a file into an unsigned nostr article */
  async createArticleDraft(file: TFile): Promise<UnsignedEvent> {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!frontmatter) throw new Error("File has no frontmatter");

    const { title, summary, image, tags, pubkey, identifier, published_at } =
      frontmatter as NostrFrontmatter;

    if (!identifier || !pubkey)
      throw new Error("File missing identifier or pubkey");

    let draft: EventTemplate;
    const content = await this.getArticleContent(file);

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
}
