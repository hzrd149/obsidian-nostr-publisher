import { App, Modal, Notice, Setting, TextComponent } from "obsidian";
import NostrArticlesPlugin from "../../main.mjs";
import { normalizeInputToProfilePointer } from "../helpers/nip19.mjs";
import { ProfilePointer } from "nostr-tools/nip19";

/**
 * Modal for entering an author's Nostr public key
 */
export default class DownloadAllArticlesInputModal extends Modal {
  private pubkey: string = "";
  private inputField!: TextComponent;

  constructor(
    app: App,
    private readonly plugin: NostrArticlesPlugin,
    private readonly onSubmit: (pointer: ProfilePointer) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Download all articles" });

    // Default to the users pubkey
    this.pubkey = this.plugin.accounts.active?.pubkey ?? "";

    // Public key input
    new Setting(contentEl)
      .setName("Public Key")
      .setDesc(
        "Enter your nostr public key (npub1...) to download all of your articles",
      )
      .addText((text) => {
        this.inputField = text;
        text
          .setPlaceholder("npub1...")
          .setValue(this.pubkey)
          .onChange((value) => {
            this.pubkey = value;
          });

        // Add keypress event to allow submission with Enter
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            this.submitForm();
          }
        });
      });

    // Create the form buttons
    const buttonContainer = contentEl.createDiv();
    buttonContainer.addClasses(["modal-button-container"]);

    // Cancel button
    buttonContainer
      .createEl("button", { text: "Cancel" })
      .addEventListener("click", () => {
        this.close();
      });

    // Download button
    const downloadButton = buttonContainer.createEl("button", {
      cls: "mod-cta",
      text: "Download All Articles",
    });
    downloadButton.addEventListener("click", () => {
      this.submitForm();
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }

  private async submitForm(): Promise<void> {
    if (!this.pubkey) {
      new Notice("Please enter your public key");
      return;
    }

    // Validate the public key
    const pointer = normalizeInputToProfilePointer(this.pubkey);
    if (!pointer) {
      new Notice("Invalid nostr public key format");
      return;
    }

    try {
      if (
        confirm(
          "Are you sure you want to download all articles? If the vault is not empty this will create duplicates",
        )
      ) {
        this.close();
        await this.onSubmit(pointer);
      }
    } catch (error) {
      console.error("Error downloading articles:", error);
      new Notice(
        `Error downloading articles: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
