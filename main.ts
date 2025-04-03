import {
  BehaviorSubject,
  filter,
  ignoreElements,
  lastValueFrom,
  Observable,
  of,
  Subscription,
  switchMap,
  toArray,
} from "rxjs";
import { App, Notice, Plugin, PluginManifest } from "obsidian";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { AccountManager } from "applesauce-accounts";
import { registerCommonAccountTypes } from "applesauce-accounts/accounts";
import { NostrConnectSigner } from "applesauce-signers/signers/nostr-connect-signer";
import { EventStore, QueryStore } from "applesauce-core";
import { EventFactory } from "applesauce-factory";
import { ActionHub } from "applesauce-actions";
import { Filter, kinds, nip19, NostrEvent } from "nostr-tools";

import ConfirmPublishModal from "./src/components/ConfirmPublishModal";
import { NostrWriterSettingTab } from "./src/views/SettingsView";
import { PublishedView, PUBLISHED_VIEW } from "./src/views/PublishedView";
import NostrPluginData, { TNostrPluginData } from "./src/schema/settings";
import NostrLoaders from "./src/service/loaders";
import { DEFAULT_FALLBACK_RELAYS } from "./src/const";
import NostrConnectModal from "./src/components/NostrConnectModal";

export default class NostrArticlesPlugin extends Plugin {
  pool = new RelayPool();
  accounts = new AccountManager<{ name: string }>();

  events = new EventStore();
  queries = new QueryStore(this.events);

  loaders = new NostrLoaders(this.pool, this.events);

  factory = new EventFactory({ signer: this.accounts.signer });
  actions = new ActionHub(this.events, this.factory);

  private cleanup: Subscription[] = [];
  private data?: TNostrPluginData;

  fallbackRelays = new BehaviorSubject<string[]>(DEFAULT_FALLBACK_RELAYS);
  lookupRelays = new BehaviorSubject<string[]>([]);

  /** Active users mailboxes */
  mailboxes: Observable<{ inboxes: string[]; outboxes: string[] } | undefined>;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);

    // Setup account manager
    registerCommonAccountTypes(this.accounts);

    // Setup default connection method
    NostrConnectSigner.subscriptionMethod = (
      filters: Filter[],
      relays: string[],
    ) => this.pool.req(relays, filters).pipe(onlyEvents());

    // Setup default publish method
    NostrConnectSigner.publishMethod = async (
      event: NostrEvent,
      relays: string[],
    ) => {
      lastValueFrom(this.pool.event(relays, event).pipe(toArray()));
    };

    // Setup computed values
    this.mailboxes = this.accounts.active$.pipe(
      switchMap((account) =>
        account ? this.queries.mailboxes(account.pubkey) : of(undefined),
      ),
    );
  }

  async onload() {
    // Load plugin settings
    this.data = NostrPluginData.parse((await this.loadData()) ?? {});

    // load settings
    this.lookupRelays.next(this.data.lookupRelays);
    this.fallbackRelays.next(this.data.fallbackRelays);

    // Load accounts
    this.accounts.fromJSON(this.data.accounts);

    // Start loaders
    this.loaders.start();

    // Start the plugin lifecycle
    this.startLifecycle();

    this.addSettingTab(new NostrWriterSettingTab(this.app, this));
    this.registerView(PUBLISHED_VIEW, (leaf) => new PublishedView(leaf, this));

    // icon candidates : 'checkmark', 'blocks', 'scroll', 'pin'
    this.addRibbonIcon("blocks", "See notes published to Nostr", () => {
      this.togglePublishedView();
    });

    this.addRibbonIcon(
      "file-up",
      "Publish this note to Nostr",
      async (evt: MouseEvent) => {
        await this.checkAndPublish();
      },
    );

    this.addCommand({
      id: "publish-note-to-nostr",
      name: "Publish",
      callback: async () => {
        await this.checkAndPublish();
      },
    });

    this.addCommand({
      id: "test-print",
      name: "Show connected relays",
      callback: async () => {
        for (let [url, relay] of this.pool.relays) {
          if (relay.connected) new Notice(`Connected to ${relay.url}`);
        }
      },
    });

    this.addCommand({
      id: "connect-nostr-account",
      name: "Connect nostr account",
      callback: () => this.connectAccount(),
    });

    this.addCommand({
      id: "account-info",
      name: "nostr account info",
      callback: async () => {
        if (!this.accounts.active) {
          new Notice("No active account");
        } else {
          new Notice(
            `Public Key: ${nip19.npubEncode(this.accounts.active?.pubkey)}`,
          );
        }
      },
    });
  }

  onunload(): void {
    // Stop all subscriptions
    for (const sub of this.cleanup) sub.unsubscribe();
    this.cleanup = [];

    // Stop loaders
    this.loaders.stop();

    this.app.workspace
      .getLeavesOfType(PUBLISHED_VIEW)
      .forEach((leaf) => leaf.detach());
  }

  private startLifecycle() {
    // Save account changes
    this.cleanup.push(
      this.accounts.accounts$.subscribe(() =>
        this.updateData({ accounts: this.accounts.toJSON() }),
      ),
    );

    // Save settings on changes
    this.cleanup.push(
      this.lookupRelays.subscribe((relays) =>
        this.updateData({ lookupRelays: relays }),
      ),
    );
    this.cleanup.push(
      this.fallbackRelays.subscribe((relays) =>
        this.updateData({ fallbackRelays: relays }),
      ),
    );

    // Lookup profile events when account changes
    this.cleanup.push(
      this.accounts.active$.pipe(filter((a) => !!a)).subscribe((account) => {
        this.loaders.replaceable.next({
          pubkey: account.pubkey,
          kind: kinds.Metadata,
        });
        this.loaders.replaceable.next({
          pubkey: account.pubkey,
          kind: kinds.Contacts,
        });
        this.loaders.replaceable.next({
          pubkey: account.pubkey,
          kind: kinds.RelayList,
        });
      }),
    );

    // Notify when mailboxes are loaded
    this.cleanup.push(
      this.mailboxes.subscribe((mailboxes) => {
        if (mailboxes) new Notice(`Found ${mailboxes.inboxes.length} relays`);
      }),
    );
  }

  private updateData(data: Partial<TNostrPluginData>) {
    this.data = NostrPluginData.parse({ ...this.data, ...data });
    this.saveData(this.data);
  }

  togglePublishedView = async (): Promise<void> => {
    const existing = this.app.workspace.getLeavesOfType(PUBLISHED_VIEW);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    await this.app.workspace.getRightLeaf(false)?.setViewState({
      type: PUBLISHED_VIEW,
      active: true,
    });

    this.app.workspace.revealLeaf(
      this.app.workspace.getLeavesOfType(PUBLISHED_VIEW)[0],
    );
  };

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

      new ConfirmPublishModal(this.app, this.pool, activeFile, this).open();
    } else {
      new Notice("❗️ No note is currently active. Click into a note.");
    }
  }

  connectAccount() {
    return new Promise<void>((resolve) => {
      new NostrConnectModal(this.app, (account) => {
        this.accounts.addAccount(account);
        this.accounts.setActive(account);

        new Notice(`${account.metadata?.name} connected`);
        resolve();
      }).open();
    });
  }
}
