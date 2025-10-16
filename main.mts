import { AccountManager } from "applesauce-accounts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";
import { ActionHub } from "applesauce-actions";
import {
  AddBlossomServer,
  RemoveBlossomServer,
  SetDefaultBlossomServer,
} from "applesauce-actions/actions/blossom";
import {
  AddOutboxRelay,
  RemoveOutboxRelay,
} from "applesauce-actions/actions/mailboxes";
import { EventStore } from "applesauce-core";
import {
  getDisplayName,
  getProfileContent,
  isSafeRelayURL,
} from "applesauce-core/helpers";
import { EventFactory } from "applesauce-factory";
import { CacheRequest } from "applesauce-loaders";
import {
  createAddressLoader,
  createEventLoader,
} from "applesauce-loaders/loaders";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { NostrConnectSigner } from "applesauce-signers/signers/nostr-connect-signer";
import { Filter, kinds, nip19, NostrEvent } from "nostr-tools";
import { App, Command, Notice, Plugin, PluginManifest } from "obsidian";
import {
  BehaviorSubject,
  bufferTime,
  combineLatest,
  debounceTime,
  EMPTY,
  filter,
  firstValueFrom,
  lastValueFrom,
  map,
  merge,
  Observable,
  of,
  shareReplay,
  skip,
  Subscription,
  switchMap,
  toArray,
} from "rxjs";

import DownloadArticleModal from "./src/components/DownloadArticleModal.mjs";
import NostrConnectModal from "./src/components/NostrConnectModal.mjs";
import PublishModal from "./src/components/PublishModal.mjs";
import { UserSearchModal } from "./src/components/UserSearchModal.mjs";
import { DEFAULT_PLUGIN_RELAYS } from "./src/const.mjs";
import NostrPluginData, {
  TNostrPluginData,
} from "./src/schema/plugin-data.mjs";
import Downloader from "./src/service/downloader.mjs";
import Publisher from "./src/service/publisher.mjs";
import { NostrWriterSettingTab } from "./src/views/SettingsView.mjs";

export default class NostrArticlesPlugin extends Plugin {
  data = new BehaviorSubject<TNostrPluginData>(NostrPluginData.parse({}));

  pool = new RelayPool();
  accounts = new AccountManager<{ name?: string }>();

  events = new EventStore();

  factory = new EventFactory({
    signer: this.accounts.signer,
    client: { name: "Obsidian Nostr publisher" },
  });
  actions = new ActionHub(this.events, this.factory);

  private cleanup: Subscription[] = [];

  localRelay = new BehaviorSubject<string>("");
  pluginRelays = new BehaviorSubject<string[]>(DEFAULT_PLUGIN_RELAYS);
  lookupRelays = new BehaviorSubject<string[]>([]);

  /** Active users mailboxes */
  publishRelays: Observable<string[]>;
  mailboxes: Observable<{ inboxes: string[]; outboxes: string[] } | undefined>;

  /** User's blossom servers from kind 10063 event */
  blossomServers: Observable<URL[] | undefined>;

  /** Sub class for managing articles */
  publisher = new Publisher(this.app, this);

  /** Sub class for downloading articles */
  downloader = new Downloader(this.app, this);

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);

    // Setup account manager
    registerCommonAccountTypes(this.accounts);

    // Setup default connection method
    NostrConnectSigner.subscriptionMethod = (
      relays: string[],
      filters: Filter[],
    ) => this.pool.req(relays, filters).pipe(onlyEvents());

    // Setup default publish method
    NostrConnectSigner.publishMethod = async (
      relays: string[],
      event: NostrEvent,
    ) => {
      lastValueFrom(this.pool.event(relays, event).pipe(toArray()));
    };

    const cacheRequest: CacheRequest = (filters) => {
      const localRelay = this.localRelay.value;
      if (!localRelay) return EMPTY;
      else return this.pool.request([localRelay], filters).pipe(onlyEvents());
    };

    // Create loaders and attach to event store
    const addressLoader = createAddressLoader(this.pool, {
      eventStore: this.events,
      lookupRelays: this.lookupRelays,
      cacheRequest,
    });
    const eventLoader = createEventLoader(this.pool, {
      eventStore: this.events,
      cacheRequest,
    });

    // Add loaders to event store
    this.events.addressableLoader = addressLoader;
    this.events.replaceableLoader = addressLoader;
    this.events.eventLoader = eventLoader;

    // @ts-ignore
    window.nostr = this;

    // Setup computed values
    this.mailboxes = this.accounts.active$.pipe(
      switchMap((account) =>
        account ? this.events.mailboxes(account.pubkey) : of(undefined),
      ),
    );

    this.publishRelays = combineLatest([
      this.pluginRelays,
      this.localRelay,
      this.mailboxes,
    ]).pipe(
      map(([pluginRelays, localRelay, mailboxes]) =>
        [localRelay, ...pluginRelays, ...(mailboxes?.outboxes ?? [])].filter(
          isSafeRelayURL,
        ),
      ),
      // share latest value and make sync
      shareReplay(1),
    );

    // Setup blossom servers from kind 10063 events
    this.blossomServers = combineLatest([
      this.accounts.active$,
      this.mailboxes,
    ]).pipe(
      switchMap(([account, mailboxes]) =>
        account && mailboxes?.outboxes?.length
          ? this.events.blossomServers({
              pubkey: account.pubkey,
              relays: mailboxes.outboxes,
            })
          : of(undefined),
      ),
      shareReplay(1),
    );
  }

  async onload() {
    // Load plugin settings
    const data = NostrPluginData.parse((await this.loadData()) ?? {});
    this.data.next(data);

    // load settings
    this.lookupRelays.next(data.lookupRelays);
    this.pluginRelays.next(data.pluginRelays);
    this.localRelay.next(data.localRelay ?? "");
    // Load accounts
    this.accounts.fromJSON(data.accounts);
    if (data.active)
      try {
        this.accounts.setActive(data.active);
      } catch (err) {}

    // Start the plugin lifecycle
    this.lifecycle();

    // Setup views
    this.addSettingTab(new NostrWriterSettingTab(this.app, this));

    this.setupGlobalCommands();
    this.setupEditorCommands();
  }

  onunload(): void {
    // Save accounts
    this.updateData({
      accounts: this.accounts.toJSON(),
      active: this.accounts.active?.id,
    });

    // Stop all subscriptions
    for (const sub of this.cleanup) sub.unsubscribe();
    this.cleanup = [];
  }

  private setupGlobalCommands() {
    this.addCommand({
      id: "publish-article",
      name: "Publish article",
      callback: async () => {
        await this.checkAndPublish();
      },
    });

    this.addCommand({
      id: "show-relays",
      name: "Show connected relays",
      callback: async () => {
        const connected = Array.from(this.pool.relays.values())
          .filter((r) => r.connected)
          .map((r) => r.url);

        new Notice(`Connected to:\n${connected.join("\n")}`);
      },
    });

    this.addCommand({
      id: "connect-nostr-account",
      name: "Connect nostr account",
      callback: () => this.connectAccount(),
    });

    this.addCommand({
      id: "download-article",
      name: "Download article",
      callback: () => this.downloadArticle(),
    });

    this.addCommand({
      id: "show-account-pubkey",
      name: "Show active account pubkey",
      callback: async () => {
        if (!this.accounts.active) {
          new Notice("No active account");
        } else {
          const pubkey = await this.accounts.active.getPublicKey();
          new Notice(`Public Key: ${nip19.npubEncode(pubkey)}`);
        }
      },
    });
  }
  private setupEditorCommands() {
    this.addCommand({
      id: "insert-pubkey-mention",
      name: "Mention pubkey",
      editorCallback: async (editor, ctx) => {
        new UserSearchModal(this.app).open();
      },
    });
  }

  private lifecycle() {
    this.lifecycleSavePluginData();
    this.switchAccountCommands();
    this.lifecycleUserNotify();

    // Load profiles for all accounts
    this.cleanup.push(
      this.accounts.accounts$
        .pipe(
          switchMap((accounts) =>
            merge(
              ...accounts.map((account) =>
                this.events.replaceable(kinds.Metadata, account.pubkey),
              ),
            ),
          ),
        )
        .subscribe(),
    );

    // Update account names when profiles are loaded
    this.events.filters({ kinds: [kinds.Metadata] }).subscribe((event) => {
      const account = this.accounts.getAccountForPubkey(event.pubkey);

      if (account) {
        try {
          const profile = getProfileContent(event);

          const name = getDisplayName(profile);
          console.log(`Updating account name for ${account.pubkey}`, name);

          account.metadata = { name };

          // Save accounts
          this.updateData({ accounts: this.accounts.toJSON() });
        } catch (error) {}
      }
    });

    // Always fetch the user's blossom servers
    this.cleanup.push(
      this.blossomServers.subscribe((servers) => {
        if (servers)
          console.log("Found user's blossom servers", servers.join(", "));
      }),
    );

    // Always fetch the user's mailboxes
    this.cleanup.push(
      this.mailboxes.subscribe((mailboxes) => {
        if (mailboxes)
          console.log("Found user's mailboxes", mailboxes.outboxes.join(", "));
      }),
    );

    // Load the article event from nostr when a file is opened
    this.registerEvent(
      this.app.workspace.on("file-open", async (file) => {
        if (file && file.extension === "md") {
          const pointer = this.publisher.getArticleNostrAddress(file);

          // If the file is published as an article try to load it
          if (pointer) {
            this.events.addressable(pointer).subscribe();
          }
        }
      }),
    );
  }

  /** Save plugin data when it changes */
  private lifecycleSavePluginData() {
    // Persist data when it changes
    this.cleanup.push(
      this.data
        .pipe(skip(1), debounceTime(1000))
        .subscribe((data) => this.saveData(data)),
    );

    // Update data when accounts change
    this.cleanup.push(
      this.accounts.accounts$.subscribe(() =>
        this.updateData({ accounts: this.accounts.toJSON() }),
      ),
    );

    this.cleanup.push(
      this.accounts.active$.subscribe((account) =>
        this.updateData({ active: account?.id }),
      ),
    );

    this.cleanup.push(
      this.pluginRelays.subscribe((relays) =>
        this.updateData({ pluginRelays: relays }),
      ),
    );
    this.cleanup.push(
      this.lookupRelays.subscribe((relays) =>
        this.updateData({ lookupRelays: relays }),
      ),
    );
    this.cleanup.push(
      this.localRelay.subscribe((relay) =>
        this.updateData({ localRelay: relay }),
      ),
    );
  }

  private switchAccountCommands() {
    let commands = new Map<string, Command>();

    this.cleanup.push(
      this.accounts.accounts$.subscribe((accounts) => {
        for (const account of accounts) {
          const command = commands.get(account.id);

          if (!command) {
            // create command
            commands.set(
              account.id,
              this.addCommand({
                id: `switch-account-${account.id}`,
                name: `Switch to ${account.metadata?.name || account.pubkey.slice(0, 8)}`,
                callback: () => this.accounts.setActive(account),
              }),
            );
          } else if (
            account.metadata?.name &&
            !command.name.contains(account.metadata?.name)
          ) {
            // Remove old command
            this.removeCommand(command.id);

            // Create new command
            commands.set(
              account.id,
              this.addCommand({
                id: `switch-account-${account.id}`,
                name: `Switch to ${account.metadata.name}`,
                callback: () => this.accounts.setActive(account),
              }),
            );
          }
        }
      }),
    );
  }

  private lifecycleUserNotify() {
    // notify when active account changes
    this.cleanup.push(
      this.accounts.active$.pipe(skip(1)).subscribe((account) => {
        if (account)
          new Notice(
            `Switched to ${account.metadata?.name || account.pubkey.slice(0, 8)}`,
          );
        else new Notice("No nostr account");
      }),
    );

    // Notify the user when articles events are loaded
    this.cleanup.push(
      this.accounts.active$
        .pipe(
          filter((a) => a !== undefined),
          switchMap((account) =>
            this.events.filters({
              authors: [account!.pubkey],
              kinds: [kinds.LongFormArticle],
            }),
          ),
          bufferTime(1000),
          filter((events) => events.length > 0),
        )
        .subscribe((events) => {
          new Notice(`Loaded ${events.length} articles`);
        }),
    );
  }

  private updateData(data: Partial<TNostrPluginData>) {
    this.data.next(NostrPluginData.parse({ ...this.data.value, ...data }));
  }

  async checkAndPublish() {
    if (!this.accounts.active) {
      new Notice(`🔑 Please add a nostr account first before publishing.`);
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      const fileContent = await this.app.vault.read(activeFile);
      if (fileContent.length === 0) {
        new Notice("❌ The note is empty and cannot be published.");
        return;
      }

      new PublishModal(this.app, activeFile, this).open();
    } else {
      new Notice("❗️ No note is currently active. Click into a note.");
    }
  }

  connectAccount() {
    return new Promise<void>((resolve) => {
      new NostrConnectModal(this.app, (account) => {
        this.accounts.addAccount(account);
        this.accounts.setActive(account);

        new Notice(`Account connected`);
        resolve();
      }).open();
    });
  }

  /**
   * Open a modal to download a single article by ID or URL
   */
  downloadArticle() {
    return new Promise<void>((resolve) => {
      new DownloadArticleModal(this.app, this, async (eventIdOrUrl: string) => {
        try {
          const file = await this.downloader.downloadArticle(eventIdOrUrl);
          new Notice(`Downloaded article to ${file.path}`);
          resolve();
        } catch (error) {
          new Notice(
            `Failed to download article: ${error instanceof Error ? error.message : String(error)}`,
          );
          resolve();
        }
      }).open();
    });
  }

  /**
   * Add a blossom server to the user's kind 10063 event
   */
  async addBlossomServer(url: string): Promise<void> {
    if (!this.accounts.active) {
      throw new Error("No active account");
    }

    const mailboxes = await firstValueFrom(this.mailboxes);
    if (!mailboxes?.outboxes?.length) {
      throw new Error("No outbox relays available");
    }

    try {
      const events = await firstValueFrom(
        this.actions.exec(AddBlossomServer, url).pipe(toArray()),
      );

      // Publish the event to outbox relays
      for (const event of events) {
        await lastValueFrom(
          this.pool.event(mailboxes.outboxes, event).pipe(toArray()),
        );
      }

      new Notice(`Added ${url} to blossom servers`);
    } catch (error) {
      console.error("Failed to add blossom server:", error);
      throw new Error(
        `Failed to add blossom server: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Remove a blossom server from the user's kind 10063 event
   */
  async removeBlossomServer(server: URL): Promise<void> {
    if (!this.accounts.active) {
      throw new Error("No active account");
    }

    const mailboxes = await firstValueFrom(this.mailboxes);
    if (!mailboxes?.outboxes?.length) {
      throw new Error("No outbox relays available");
    }

    try {
      const events = await firstValueFrom(
        this.actions.exec(RemoveBlossomServer, server).pipe(toArray()),
      );

      // Publish the event to outbox relays
      for (const event of events) {
        await lastValueFrom(
          this.pool.event(mailboxes.outboxes, event).pipe(toArray()),
        );
      }

      new Notice(`Removed ${server.toString()} from blossom servers`);
    } catch (error) {
      console.error("Failed to remove blossom server:", error);
      throw new Error(
        `Failed to remove blossom server: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Set a blossom server as the default (move to top of list)
   */
  async setDefaultBlossomServer(server: URL): Promise<void> {
    if (!this.accounts.active) {
      throw new Error("No active account");
    }

    const mailboxes = await firstValueFrom(this.mailboxes);
    if (!mailboxes?.outboxes?.length) {
      throw new Error("No outbox relays available");
    }

    try {
      const events = await firstValueFrom(
        this.actions.exec(SetDefaultBlossomServer, server).pipe(toArray()),
      );

      // Publish the event to outbox relays
      for (const event of events) {
        await lastValueFrom(
          this.pool.event(mailboxes.outboxes, event).pipe(toArray()),
        );
      }

      new Notice(`Set ${server.toString()} as default blossom server`);
    } catch (error) {
      console.error("Failed to set default blossom server:", error);
      throw new Error(
        `Failed to set default blossom server: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Add an outbox relay to the user's kind 10002 relay list
   */
  async addOutboxRelay(relay: string): Promise<void> {
    if (!this.accounts.active) {
      throw new Error("No active account");
    }

    const mailboxes = await firstValueFrom(this.mailboxes);
    if (!mailboxes?.outboxes?.length) {
      throw new Error("No outbox relays available");
    }

    try {
      const events = await firstValueFrom(
        this.actions.exec(AddOutboxRelay, relay).pipe(toArray()),
      );

      // Publish the event to outbox relays
      for (const event of events) {
        await this.pool.publish(mailboxes.outboxes, event);
      }

      new Notice(`Added ${relay} to outbox relays`);
    } catch (error) {
      console.error("Failed to add outbox relay:", error);
      throw new Error(
        `Failed to add outbox relay: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Remove an outbox relay from the user's kind 10002 relay list
   */
  async removeOutboxRelay(relay: string): Promise<void> {
    if (!this.accounts.active) {
      throw new Error("No active account");
    }

    const mailboxes = await firstValueFrom(this.mailboxes);
    if (!mailboxes?.outboxes?.length) {
      throw new Error("No outbox relays available");
    }

    try {
      const events = await firstValueFrom(
        this.actions.exec(RemoveOutboxRelay, relay).pipe(toArray()),
      );

      // Publish the event to outbox relays
      for (const event of events) {
        await this.pool.publish(mailboxes.outboxes, event);
      }

      new Notice(`Removed ${relay} from outbox relays`);
    } catch (error) {
      console.error("Failed to remove outbox relay:", error);
      throw new Error(
        `Failed to remove outbox relay: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Add a lookup relay to the plugin settings
   */
  async addLookupRelay(relay: string): Promise<void> {
    const currentRelays = this.lookupRelays.value;
    if (currentRelays.includes(relay)) {
      throw new Error("Relay already exists");
    }

    const newRelays = [...currentRelays, relay];
    this.lookupRelays.next(newRelays);
    new Notice(`Added ${relay} to lookup relays`);
  }

  /**
   * Remove a lookup relay from the plugin settings
   */
  async removeLookupRelay(relay: string): Promise<void> {
    const currentRelays = this.lookupRelays.value;
    const newRelays = currentRelays.filter((r) => r !== relay);
    this.lookupRelays.next(newRelays);
    new Notice(`Removed ${relay} from lookup relays`);
  }
}
