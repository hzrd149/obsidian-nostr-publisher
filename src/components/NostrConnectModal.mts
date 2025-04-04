import { App, Modal, Notice, Setting } from "obsidian";
import { NostrConnectSigner } from "applesauce-signers";
import { NostrConnectAccount } from "applesauce-accounts/accounts";
import QRCode from "qrcode-svg";

import { DEFAULT_CONNECT_RELAY } from "../const.mjs";

export default class NostrConnectModal extends Modal {
  private signer?: NostrConnectSigner;

  constructor(
    app: App,
    private onConnect: (
      account: NostrConnectAccount<{ name?: string }>,
    ) => void,
  ) {
    super(app);

    this.setTitle("Connect a nostr account");

    let relay: string = DEFAULT_CONNECT_RELAY;

    new Setting(this.contentEl)
      .setName("Connection relay")
      .setDesc("A nostr relay to use to connect to the signer")
      .addText((text) => {
        text.setValue(DEFAULT_CONNECT_RELAY);
        text.setPlaceholder("wss://relay.connect.app");

        text.onChange((v) => (relay = v));
      });

    new Setting(this.contentEl).addButton((btn) => {
      btn.setButtonText("Connect");
      btn.setCta();
      btn.setTooltip("Start the nostr connect process");

      btn.onClick(async () => {
        if (!relay) new Notice("Add connection relay");

        btn.setDisabled(true);
        btn.setButtonText("Connecting...");

        try {
          await this.createAccount(relay);
        } catch (error) {
          btn.setButtonText("Connect");
          btn.setDisabled(false);

          console.log(error);
          new Notice(
            `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
      });
    });
  }

  private async createAccount(relay: string) {
    this.contentEl.empty();

    // Create new signer
    this.signer = new NostrConnectSigner({ relays: [relay] });

    const uri = this.signer.getNostrConnectURI();

    // Show connect URI
    new Setting(this.contentEl)
      .setName("Connect URI")
      .setDesc("Copy and paste this into a nostr signer app to connect")
      .addText((text) => {
        text.setValue(uri);
        text.setDisabled(true);
        text.inputEl.style.userSelect = "all";
      })
      .addButton((btn) => {
        btn.setButtonText("Copy");
        btn.setTooltip("Copy the connect URI to your clipboard");
        btn.onClick(() => {
          btn.setButtonText("Copied");
          navigator.clipboard.writeText(uri);

          setTimeout(() => {
            btn.setButtonText("Copy");
          }, 1000);
        });
      });

    // Show connect QRCode
    this.contentEl.createDiv("qrcode", (div) => {
      div.style.textAlign = "center";
      div.innerHTML = new QRCode(uri).svg();
    });

    // Cancel waiting for signer
    new Setting(this.contentEl).addButton((btn) => {
      btn.setButtonText("Cancel");
      btn.setTooltip("Cancel the nostr connect process");
      btn.setWarning();
      btn.onClick(() => {
        this.close();
      });
    });

    new Notice("Waiting for nostr signer to connect...");

    // Wait for connection
    await this.signer.waitForSigner();

    // Create account
    const pubkey = await this.signer.getPublicKey();
    const account = new NostrConnectAccount<{ name?: string }>(
      pubkey,
      this.signer!,
    );

    this.onConnect(account);
    this.close();
  }

  onClose(): void {
    if (this.signer) {
      this.signer.close();
      this.signer = undefined;

      new Notice("Nostr connect process cancelled");
    }
  }
}
