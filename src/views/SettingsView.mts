import { nip19 } from "nostr-tools";
import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  TextComponent,
} from "obsidian";
import { Subscription, combineLatest } from "rxjs";

import NostrArticlesPlugin from "../../main.mjs";
import DownloadAllArticlesInputModal from "../components/DownloadAllArticlesInputModal.mjs";
import { isValidUrl } from "../helpers/url.mjs";

export class NostrWriterSettingTab extends PluginSettingTab {
  plugin: NostrArticlesPlugin;
  private refreshDisplay: () => void;
  private subscriptions: Subscription[] = [];

  constructor(app: App, plugin: NostrArticlesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.refreshDisplay = () => this.display();
  }

  hide(): void {
    // Clean up subscriptions when settings tab is hidden
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
  }

  display(): void {
    // Clean up any existing subscriptions
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];

    let { containerEl } = this;
    containerEl.empty();

    new Setting(this.containerEl)
      .setName("Connect account")
      .setDesc("Connect a remote signer to start writing articles.")
      .addButton((btn) => {
        btn.setButtonText("Connect");
        btn.setCta();
        btn.setTooltip("Connect a new nostr account");
        btn.onClick(async () => {
          await this.plugin.connectAccount();
        });
      });

    // Display accounts reactively
    this.displayAccounts();

    new Setting(this.containerEl)
      .setName("Local relay")
      .setDesc(
        "A local nostr relay used to search for events and save articles.",
      )
      .addText((text) => {
        text.setPlaceholder("ws://localhost:4869");
        text.setValue(this.plugin.localRelay.value);
        text.onChange((value) => {
          this.plugin.localRelay.next(value);
        });
      });

    containerEl.createEl("br");

    // Display relays reactively
    this.displayRelays();

    containerEl.createEl("br");

    // Display lookup relays reactively
    this.displayLookupRelays();

    containerEl.createEl("br");

    // Blossom Servers section - now using Nostr kind 10063 events
    this.displayBlossomServers();

    containerEl.createEl("br");

    containerEl.createEl("h5", { text: "Download Settings" });
    new Setting(this.containerEl)
      .setName("Media download folder")
      .setDesc(
        "Path where images and media from downloaded articles will be saved (relative to vault root).",
      )
      .addText((text) => {
        text.setPlaceholder("media");
        text.setValue(this.plugin.data.value.mediaDownloadFolder || "media");
        text.onChange((value) => {
          // Update the data in the plugin's data BehaviorSubject
          this.plugin.data.next({
            ...this.plugin.data.value,
            mediaDownloadFolder: value,
          });
        });
      });

    new Setting(this.containerEl)
      .setName("Download all articles")
      .setDesc("Download all of your nostr articles to the vault")
      .addButton((btn) => {
        btn.setButtonText("Download");
        btn.setCta();
        btn.setTooltip("Download all nostr articles to vault");
        btn.onClick(async () => {
          // Open the download modal
          new DownloadAllArticlesInputModal(
            this.app,
            this.plugin,
            async (pointer) => {
              try {
                const files =
                  await this.plugin.downloader.downloadAuthorArticles(pointer);
                new Notice(`Downloaded ${files.length} articles`);
              } catch (error) {
                new Notice(
                  `Failed to download articles: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
            },
          ).open();
        });
      });
  }

  private displayRelays(): void {
    const containerEl = this.containerEl;

    containerEl.createEl("h5", { text: "Publish relays" });

    // Check if user is connected
    if (!this.plugin.accounts.active) {
      new Setting(containerEl)
        .setName("Connect to manage relays")
        .setDesc(
          "You need to connect a Nostr account to manage your outbox relays.",
        )
        .addButton((btn) => {
          btn.setButtonText("Connect Account");
          btn.setCta();
          btn.onClick(async () => {
            await this.plugin.connectAccount();
          });
        });
      return;
    }

    // Add relay form
    let relayInput: TextComponent;
    new Setting(containerEl)
      .setDesc("Add an outbox relay for publishing.")
      .setName("Add relay")
      .addText((text) => {
        text.setPlaceholder("wss://fav.relay.com");
        text.onChange(() => {
          relayInput = text;
        });
      })
      .addButton((btn) => {
        btn.setIcon("plus");
        btn.setCta();
        btn.setTooltip("Add this relay");
        btn.onClick(async () => {
          try {
            let addedRelayUrl = relayInput.getValue().trim();
            if (!addedRelayUrl) {
              new Notice("Please enter a relay URL");
              return;
            }

            if (isValidUrl(addedRelayUrl)) {
              await this.plugin.addOutboxRelay(addedRelayUrl);
              relayInput.setValue("");
            } else {
              new Notice("Invalid URL");
            }
          } catch (error) {
            new Notice(
              `Failed to add relay: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          }
        });
      });

    // Create container for relay list that will be updated reactively
    const relaysContainer = containerEl.createEl("div");
    relaysContainer.addClass("relays-container");

    // Subscribe to mailboxes and update UI reactively
    const relaysSubscription = this.plugin.mailboxes.subscribe((mailboxes) => {
      // Clear previous relay list
      relaysContainer.empty();

      if (!mailboxes?.outboxes?.length) {
        new Setting(relaysContainer)
          .setName("No outbox relays configured")
          .setDesc("Add an outbox relay above to publish events.");
        return;
      }

      mailboxes.outboxes.forEach((relay) => {
        const displayUrl = relay.replace("wss://", "").replace("ws://", "");

        new Setting(relaysContainer).setName(displayUrl).addButton((btn) => {
          btn.setIcon("trash");
          btn.setTooltip("Remove this relay");
          btn.onClick(async () => {
            if (confirm(`Are you sure you want to remove ${displayUrl}?`)) {
              try {
                await this.plugin.removeOutboxRelay(relay);
              } catch (error) {
                new Notice(
                  `Failed to remove relay: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
              }
            }
          });
        });
      });
    });

    // Store subscription for cleanup
    this.subscriptions.push(relaysSubscription);
  }

  private displayLookupRelays(): void {
    const containerEl = this.containerEl;

    containerEl.createEl("h5", { text: "Lookup relays" });

    // Add relay form
    let relayInput: TextComponent;
    new Setting(containerEl)
      .setDesc("Add a lookup relay for searching events.")
      .setName("Add relay")
      .addText((text) => {
        text.setPlaceholder("wss://fav.relay.com");
        text.onChange(() => {
          relayInput = text;
        });
      })
      .addButton((btn) => {
        btn.setIcon("plus");
        btn.setCta();
        btn.setTooltip("Add this relay");
        btn.onClick(async () => {
          try {
            let addedRelayUrl = relayInput.getValue().trim();
            if (!addedRelayUrl) {
              new Notice("Please enter a relay URL");
              return;
            }

            if (isValidUrl(addedRelayUrl)) {
              await this.plugin.addLookupRelay(addedRelayUrl);
              relayInput.setValue("");
            } else {
              new Notice("Invalid URL");
            }
          } catch (error) {
            new Notice(
              `Failed to add relay: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          }
        });
      });

    // Create container for relay list that will be updated reactively
    const relaysContainer = containerEl.createEl("div");
    relaysContainer.addClass("lookup-relays-container");

    // Subscribe to lookup relays and update UI reactively
    const relaysSubscription = this.plugin.lookupRelays.subscribe((relays) => {
      // Clear previous relay list
      relaysContainer.empty();

      if (!relays || relays.length === 0) {
        new Setting(relaysContainer)
          .setName("No lookup relays configured")
          .setDesc("Add a lookup relay above to search for events.");
        return;
      }

      relays.forEach((relay) => {
        const displayUrl = relay.replace("wss://", "").replace("ws://", "");

        new Setting(relaysContainer).setName(displayUrl).addButton((btn) => {
          btn.setIcon("trash");
          btn.setTooltip("Remove this relay");
          btn.onClick(async () => {
            if (confirm(`Are you sure you want to remove ${displayUrl}?`)) {
              try {
                await this.plugin.removeLookupRelay(relay);
              } catch (error) {
                new Notice(
                  `Failed to remove relay: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
              }
            }
          });
        });
      });
    });

    // Store subscription for cleanup
    this.subscriptions.push(relaysSubscription);
  }

  private displayAccounts(): void {
    const containerEl = this.containerEl;

    // Create container for accounts list that will be updated reactively
    const accountsContainer = containerEl.createEl("div");
    accountsContainer.addClass("accounts-container");

    // Subscribe to both accounts and active account changes
    const accountsSubscription = combineLatest([
      this.plugin.accounts.accounts$,
      this.plugin.accounts.active$,
    ]).subscribe(([accounts, activeAccount]) => {
      // Clear previous accounts list
      accountsContainer.empty();

      if (accounts.length === 0) {
        new Setting(accountsContainer)
          .setName("No accounts connected")
          .setDesc("Connect an account above to get started.");
        return;
      }

      accounts.forEach((account) => {
        const isActive = activeAccount?.id === account.id;
        const displayName =
          account.metadata?.name || account.pubkey.slice(0, 8);
        const npub = nip19.npubEncode(account.pubkey);

        let card = new Setting(accountsContainer)
          .setName(displayName)
          .setDesc(isActive ? `🟢 Active - ${npub}` : npub);

        if (!isActive) {
          card = card.addButton((btn) => {
            btn.setIcon("user");
            btn.setTooltip("Switch to this account");
            btn.onClick(async () => {
              this.plugin.accounts.setActive(account);
            });
          });
        }

        // Add remove button
        card = card.addButton((btn) => {
          btn.setIcon("trash");
          btn.setWarning();
          btn.setTooltip("Remove this account");
          btn.onClick(async () => {
            if (
              confirm(
                "Are you sure you want to delete this account? This cannot be undone.",
              )
            ) {
              this.plugin.accounts.removeAccount(account);
              new Notice("🗑️ Account deleted.");
            }
          });
        });
      });
    });

    // Store subscription for cleanup
    this.subscriptions.push(accountsSubscription);
  }

  private displayBlossomServers(): void {
    const containerEl = this.containerEl;

    containerEl.createEl("h5", { text: "Blossom servers" });

    // Check if user is connected
    if (!this.plugin.accounts.active) {
      new Setting(containerEl)
        .setName("Connect to manage blossom servers")
        .setDesc(
          "You need to connect a Nostr account to manage your blossom servers.",
        )
        .addButton((btn) => {
          btn.setButtonText("Connect Account");
          btn.setCta();
          btn.onClick(async () => {
            await this.plugin.connectAccount();
            this.refreshDisplay();
          });
        });
      return;
    }

    // Add server form
    let serverInput: TextComponent;
    new Setting(containerEl)
      .setDesc("Add a blossom server for media uploads.")
      .setName("Add server")
      .addText((text) => {
        text.setPlaceholder(
          "wss://blossom.example.com or https://cdn.example.com",
        );
        text.onChange(() => {
          serverInput = text;
        });
      })
      .addButton((btn) => {
        btn.setIcon("plus");
        btn.setCta();
        btn.setTooltip("Add a blossom server");
        btn.onClick(async () => {
          try {
            let url = serverInput.getValue().trim();
            if (!url) {
              new Notice("Please enter a URL");
              return;
            }

            // Add wss:// prefix if missing and no protocol specified
            if (
              !url.startsWith("wss://") &&
              !url.startsWith("ws://") &&
              !url.startsWith("http")
            ) {
              url = `wss://${url}`;
            }

            if (isValidUrl(url)) {
              await this.plugin.addBlossomServer(url);
              serverInput.setValue("");
            } else {
              new Notice("Invalid URL");
            }
          } catch (error) {
            new Notice(
              `Failed to add server: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          }
        });
      });

    // Create container for server list that will be updated reactively
    const serversContainer = containerEl.createEl("div");
    serversContainer.addClass("blossom-servers-container");

    // Subscribe to blossom servers and update UI reactively
    const subscription = this.plugin.blossomServers.subscribe((servers) => {
      // Clear previous server list
      serversContainer.empty();

      if (!servers || servers.length === 0) {
        new Setting(serversContainer)
          .setName("No blossom servers configured")
          .setDesc(
            "Add a blossom server above to get started with media uploads.",
          );
        return;
      }

      servers.forEach((server, index) => {
        const displayUrl = server.hostname;
        const isDefault = index === 0;

        let setting = new Setting(serversContainer).setName(displayUrl);

        if (isDefault) setting.setDesc("Default server");
        else {
          setting.addButton((btn) => {
            btn.setIcon("star");
            if (!isDefault) btn.setTooltip("Set as default");
            btn.setDisabled(isDefault);
            btn.onClick(async () => {
              try {
                await this.plugin.setDefaultBlossomServer(server);
              } catch (error) {
                new Notice(
                  `Failed to set default: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
              }
            });
          });
        }

        // Remove button
        setting.addButton((btn) => {
          btn.setIcon("trash");
          btn.setTooltip("Remove this server");
          btn.onClick(async () => {
            if (confirm(`Are you sure you want to remove ${displayUrl}?`)) {
              try {
                await this.plugin.removeBlossomServer(server);
              } catch (error) {
                new Notice(
                  `Failed to remove server: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
              }
            }
          });
        });
      });
    });

    // Store subscription for cleanup
    this.subscriptions.push(subscription);
  }
}
