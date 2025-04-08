import { App, Modal, Notice, Setting, TextComponent } from "obsidian";
import NostrArticlesPlugin from "../../main.mjs";

/**
 * Modal for downloading a Nostr article by event ID or URL
 */
export default class DownloadArticleModal extends Modal {
  private eventIdOrUrl: string = "";
  private inputField!: TextComponent; // Using the definite assignment assertion

  constructor(
    app: App,
    private readonly plugin: NostrArticlesPlugin,
    private readonly onSubmit: (eventIdOrUrl: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Download Nostr Article" });

    // Event ID or URL input
    new Setting(contentEl)
      .setName("Nostr Address or URL")
      .setDesc("Enter a naddr1... address, or URL")
      .addText((text) => {
        this.inputField = text;
        text
          .setPlaceholder("addr1... or URL")
          .setValue(this.eventIdOrUrl)
          .onChange((value) => {
            this.eventIdOrUrl = value;
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
      text: "Download",
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
    if (!this.eventIdOrUrl) {
      new Notice("Please enter a naddr1 address or URL");
      return;
    }

    try {
      this.close();
      await this.onSubmit(this.eventIdOrUrl);
    } catch (error) {
      console.error("Error downloading article:", error);
      new Notice(
        `Error downloading article: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
