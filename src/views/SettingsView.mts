import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  TextComponent,
} from "obsidian";
import { nip19 } from "nostr-tools";

import NostrArticlesPlugin from "../../main.mjs";
import { isValidUrl } from "../helpers/url.mjs";

export class NostrWriterSettingTab extends PluginSettingTab {
  plugin: NostrArticlesPlugin;
  private refreshDisplay: () => void;

  constructor(app: App, plugin: NostrArticlesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.refreshDisplay = () => this.display();
  }

  display(): void {
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
          this.refreshDisplay();
        });
      });

    // Display all accounts
    for (const account of this.plugin.accounts.accounts) {
      new Setting(this.containerEl)
        .setName(account.metadata?.name || account.pubkey.slice(0, 8))
        .setDesc(nip19.npubEncode(account.pubkey))
        .addButton((btn) => {
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
              this.refreshDisplay();
              new Notice("🗑️ Account deleted.");
            }
          });
        });
    }

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

    let relayInput: TextComponent;

    containerEl.createEl("h5", { text: "Nostr Relays" });
    new Setting(this.containerEl)
      .setDesc("Add a relay for publishing.")
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
            let addedRelayUrl = relayInput.getValue();
            if (isValidUrl(addedRelayUrl)) {
              this.plugin.pluginRelays.next([
                ...this.plugin.pluginRelays.value,
                addedRelayUrl,
              ]);

              new Notice(`Added ${addedRelayUrl} to relay configuration.`);

              this.refreshDisplay();
              relayInput.setValue("");
            } else {
              new Notice("Invalid URL");
            }
          } catch {
            new Notice("No URL");
          }
        });
      });

    // Display all plugin relays
    for (const url of this.plugin.pluginRelays.value) {
      new Setting(this.containerEl).setName(url).addButton((btn) => {
        btn.setIcon("trash");
        btn.setTooltip("Remove this relay");
        btn.onClick(async () => {
          if (
            confirm(
              "Are you sure you want to delete this relay? This cannot be undone.",
            )
          ) {
            this.plugin.pluginRelays.next(
              this.plugin.pluginRelays.value.filter((r) => r !== url),
            );

            this.refreshDisplay();
            new Notice(`${url} removed.`);
          }
        });
      });
    }

    containerEl.createEl("br");

    let serverInput: TextComponent;

    containerEl.createEl("h5", { text: "Blossom Servers" });
    new Setting(this.containerEl)
      .setDesc("Add a blossom server for media uploads.")
      .setName("Add server")
      .addText((text) => {
        text.setPlaceholder("https://cdn.example.com");
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
            let url = serverInput.getValue();
            if (isValidUrl(url)) {
              this.plugin.mediaServers.next([
                ...this.plugin.mediaServers.value,
                url,
              ]);

              new Notice(`Added ${url} to media servers.`);

              this.refreshDisplay();
              serverInput.setValue("");
            } else {
              new Notice("Invalid URL");
            }
          } catch {
            new Notice("No URL");
          }
        });
      });

    // Display all media servers
    for (const url of this.plugin.mediaServers.value) {
      new Setting(this.containerEl).setName(url).addButton((btn) => {
        btn.setIcon("trash");
        btn.setTooltip("Remove this server");
        btn.onClick(async () => {
          if (confirm("Are you sure you want to remove this server?")) {
            this.plugin.mediaServers.next(
              this.plugin.mediaServers.value.filter((r) => r !== url),
            );

            this.refreshDisplay();
            new Notice(`${url} removed.`);
          }
        });
      });
    }
  }
}

function isValidPrivateKey(key: string): boolean {
  return typeof key === "string" && key.length === 63 && key.startsWith("nsec");
}
