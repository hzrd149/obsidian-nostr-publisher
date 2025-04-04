import { App, Modal, Notice, Setting } from "obsidian";
import { NostrConnectSigner, Permission } from "applesauce-signers";
import { NostrConnectAccount } from "applesauce-accounts/accounts";
import QRCode from "qrcode-svg";

import { DEFAULT_CONNECT_RELAY } from "../const.mjs";
import { kinds } from "nostr-tools";

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
          const account = await this.connectAccount(relay);
          this.onConnect(account);
          this.close();
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

    this.contentEl.createEl("h5", { text: "Bunker URI" });
    this.contentEl.createEl("p", {
      text: "Connect using a bunker URI",
    });

    let bunkerURI = "";
    this.contentEl.createEl("textarea", {}, (el) => {
      el.style.width = "100%";
      el.setAttribute("spellcheck", "false");
      el.setAttribute("placeholder", "bunker://");
      el.addEventListener("change", (e) => {
        bunkerURI = (e.target as HTMLTextAreaElement).value;
      });
    });

    new Setting(this.contentEl).addButton((btn) => {
      btn.setButtonText("Connect");
      btn.setTooltip("Connect using a bunker URI");
      btn.setCta();

      btn.onClick(async () => {
        if (!bunkerURI) {
          new Notice("Add a bunker URI");
          return;
        }

        try {
          NostrConnectSigner.parseBunkerURI(bunkerURI);
        } catch (error) {
          new Notice("Invalid bunker URI");
          return;
        }

        const account = await this.connectBunker(bunkerURI);
        this.onConnect(account);
        this.close();
      });
    });
  }

  private async connectAccount(relay: string) {
    this.contentEl.empty();

    // Create new signer
    this.signer = new NostrConnectSigner({ relays: [relay] });

    const uri = this.signer.getNostrConnectURI({
      name: "Obsidian Nostr Article",
      permissions: NostrConnectSigner.buildSigningPermissions([
        kinds.LongFormArticle,
      ]),
    });

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

    return account;
  }

  private async connectBunker(uri: string) {
    this.contentEl.empty();
    this.contentEl.createEl("h5", { text: "Connecting..." });

    const signer = await NostrConnectSigner.fromBunkerURI(uri);

    const pubkey = await signer.getPublicKey();
    const account = new NostrConnectAccount<{ name?: string }>(pubkey, signer);

    return account;
  }

  onClose(): void {
    if (this.signer) {
      this.signer.close();
      this.signer = undefined;

      new Notice("Nostr connect process cancelled");
    }
  }
}
