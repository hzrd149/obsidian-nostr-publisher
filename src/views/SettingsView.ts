import {
  App,
  Notice,
  PluginSettingTab,
  Setting,
  TextComponent,
} from "obsidian";

import NostrArticlesPlugin from "../../main";

import { isValidUrl } from "../helpers/url";
import { normalizePrivateKey } from "../helpers/nip19";
import { SimpleAccount } from "applesauce-accounts/accounts";
import NostrConnectModal from "../components/NostrConnectModal";
import { nip19 } from "nostr-tools";

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

    for (const account of this.plugin.accounts.accounts) {
      new Setting(this.containerEl)
        .setName(account.metadata?.name || account.pubkey.slice(0, 8))
        .setDesc(nip19.npubEncode(account.pubkey))
        .addButton((btn) => {
          btn.setIcon("trash");
          btn.setWarning();
          btn.setTooltip("Remove this profile");
          btn.onClick(async () => {
            if (
              confirm(
                "Are you sure you want to delete this profile? This cannot be undone.",
              )
            ) {
              this.plugin.accounts.removeAccount(account);
              this.refreshDisplay();
              new Notice("🗑️ Profile successfully deleted.");
            }
          });
        });
    }

    containerEl.createEl("br");

    let relayInput: TextComponent;

    containerEl.createEl("h5", { text: "Relay Configuration" });
    new Setting(this.containerEl)
      .setDesc("Add a relay URL to settings")
      .setName("Add Relay")
      .addText((relayUrlInput) => {
        relayUrlInput.setPlaceholder("wss://fav.relay.com");
        relayUrlInput.onChange(() => {
          relayInput = relayUrlInput;
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
              this.plugin.fallbackRelays.next([
                ...this.plugin.fallbackRelays.value,
                addedRelayUrl,
              ]);

              new Notice(`Added ${addedRelayUrl} to relay configuration.`);

              this.refreshDisplay();
              relayInput.setValue("");
            } else {
              new Notice("Invalid URL added");
            }
          } catch {
            new Notice("No URL added");
          }
        });
      });

    for (const url of this.plugin.fallbackRelays.value) {
      new Setting(this.containerEl).setName(url).addButton((btn) => {
        btn.setIcon("trash");
        btn.setTooltip("Remove this relay");
        btn.onClick(async () => {
          if (
            confirm(
              "Are you sure you want to delete this relay? This cannot be undone.",
            )
          ) {
            this.plugin.fallbackRelays.next(
              this.plugin.fallbackRelays.value.filter((r) => r !== url),
            );

            this.refreshDisplay();
            new Notice("Relay successfully deleted.");
          }
        });
      });
    }

    //   containerEl.createEl("h5", { text: "Support" });
    //   new Setting(this.containerEl)
    //     .setDesc(
    //       "Has this plugin enhanced your workflow? Say thanks as a one-time payment and zap/buy me a coffee.",
    //     )
    //     .addButton((bt) => {
    //       bt.setTooltip("Copy 20k sats lightning invoice")
    //         .setIcon("zap")
    //         .setCta()
    //         .onClick(() => {
    //           if (privateKeyField) {
    //             navigator.clipboard.writeText(
    //               "lnbc200u1pjvu03dpp5x20p0q5tdwylg5hsqw3av6qxufah0y64efldazmgad2rsffgda8qdpdfehhxarjypthy6t5v4ezqnmzwd5kg6tpdcs9qmr4va5kucqzzsxqyz5vqsp5w55p4tzawyfz5fasflmsvdfnnappd6hqnw9p7y2p0nl974f0mtkq9qyyssqq6gvpnvvuftqsdqyxzn9wrre3qfkpefzz6kqwssa3pz8l9mzczyq4u7qdc09jpatw9ekln9gh47vxrvx6zg6vlsqw7pq4a7kvj4ku4qpdrflwj",
    //             );
    //             new Notice("Lightning Invoice Address Copied!⚡️");
    //             setTimeout(() => {
    //               new Notice("Thank You 🤝");
    //             }, 500);
    //             setTimeout(() => {
    //               new Notice("Stay Humble ⚖️");
    //             }, 1000);
    //             setTimeout(() => {
    //               new Notice("Stack Sats ⚡️");
    //             }, 1500);
    //           }
    //         });
    //     })
  }
}

function isValidPrivateKey(key: string): boolean {
  return typeof key === "string" && key.length === 63 && key.startsWith("nsec");
}
