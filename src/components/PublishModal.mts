import { Subscription } from "rxjs";
import {
  ButtonComponent,
  Modal,
  Notice,
  TFile,
  App,
  TextAreaComponent,
  TextComponent,
  Setting,
  EmbedCache,
} from "obsidian";
import { unixNow } from "applesauce-core/helpers";
import { BlobDescriptor } from "blossom-client-sdk";
import { kinds } from "nostr-tools";

import NostrArticlesPlugin from "../../main.mjs";
import { NostrFrontmatter } from "../schema/frontmatter.mjs";

export default class PublishModal extends Modal {
  private cleanup: Subscription[] = [];

  constructor(
    app: App,
    public readonly file: TFile,
    public readonly plugin: NostrArticlesPlugin,
  ) {
    super(app);
  }

  async onOpen() {
    let { contentEl } = this;

    // Subscribe to app settings
    let relays: string[] = [];
    this.cleanup.push(
      this.plugin.mailboxes.subscribe((mailboxes) => {
        if (mailboxes) relays = mailboxes.outboxes;
      }),
    );
    let servers: string[] = [];
    this.cleanup.push(
      this.plugin.blossomServers.subscribe((blossomServers) => {
        servers = blossomServers?.map((url) => url.toString()) || [];
      }),
    );

    const frontmatter = this.app.metadataCache.getFileCache(this.file)
      ?.frontmatter as NostrFrontmatter | null;

    if (this.file.extension !== "md") {
      new Notice("❌ Only markdown files can be published.");
      this.close();
      return;
    }

    const rawContent = await this.app.vault.read(this.file);

    let hashtags: string[] = [];

    const regex = /#\w+/g;
    const matches = rawContent.match(regex) || [];
    const contentHashtags = matches.map((match: string) => match.slice(1));

    const today = new Date();
    const fallbackIdentifier =
      this.file.basename.replace(/\s/g, "-").toLowerCase() +
      "-" +
      today.toLocaleDateString();

    const properties = {
      title: frontmatter?.title || this.file.basename,
      summary: frontmatter?.summary || "",
      image: frontmatter?.image,
      tags: frontmatter?.tags || contentHashtags,
      identifier: frontmatter?.identifier || fallbackIdentifier,
      published_at: frontmatter?.published_at || unixNow(),
    };

    for (const tag of properties.tags) hashtags.push(tag);

    this.setTitle("Publish");

    contentEl.createEl("h6", { text: `Title` });
    let titleText = new TextComponent(contentEl)
      .setPlaceholder(properties.title)
      .setValue(properties.title);

    contentEl.createEl("h6", { text: `Tags` });
    const tagContainer = contentEl.createEl("div");
    tagContainer.addClass("publish-title-container");

    tagContainer.createEl("p", {
      text: `Tags (#tags) from your file are automatically added below. Add more to help people discover your work. Remove any by clicking the X. `,
    });

    let tagsText = new TextComponent(contentEl).setPlaceholder(
      `Add a tag here and press enter`,
    );

    tagsText.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        addTagAsPill(tagsText.getValue());
      }
    });

    tagsText.inputEl.setCssStyles({
      width: "100%",
      marginBottom: "10px",
    });

    const pillsContainer = contentEl.createEl("div");
    pillsContainer.addClass("pills-container");
    hashtags.forEach((tag) => {
      const pillElement = createPillElement(tag);
      pillsContainer.appendChild(pillElement);
    });

    contentEl.createEl("h6", { text: `Summary` });
    let summaryText = new TextAreaComponent(contentEl)
      .setPlaceholder("Optional brief summary of your article...")
      .setValue(properties.summary);

    let uploadMedia = servers.length > 0;
    new Setting(contentEl)
      .setName("Upload media")
      .setDesc("Upload embed images to blossom servers.")
      .addToggle((toggle) => {
        toggle.setTooltip("Upload media to a blossom servers.");
        toggle.setValue(uploadMedia);
        toggle.onChange((value) => (uploadMedia = value));
      });

    // let image: any | null = null;

    // new Setting(contentEl)
    //   .setName("Upload Banner Image")
    //   .setDesc("Optional image to be shown alongside your articles title.")
    //   .addButton((button) =>
    //     button
    //       .setButtonText("Upload")
    //       .setIcon("upload")
    //       .setTooltip("Upload an image file for your article banner.")
    //       .onClick(async () => {
    //         const input = document.createElement("input");
    //         input.type = "file";
    //         input.multiple = false;

    //         input.click();

    //         input.addEventListener("change", async () => {
    //           if (input.files !== null) {
    //             const file = input.files[0];
    //             if (file) {
    //               if (!file.type.startsWith("image/")) {
    //                 new Notice("❌ Invalid file type. Please upload an image.");
    //                 return;
    //               }

    //               let maxSizeInBytes = 10 * 1024 * 1024; // 10 MB
    //               if (file.size > maxSizeInBytes) {
    //                 new Notice(
    //                   "❌ File size exceeds the limit. Please upload a smaller image.",
    //                 );
    //                 return;
    //               }
    //               image = file;

    //               imagePreview.src = URL.createObjectURL(image);
    //               imagePreview.style.display = "block";
    //               clearImageButton.style.display = "inline-block";

    //               imageNameDiv.textContent = image.name;
    //               new Notice(`✅ Selected image : ${file.name}`);
    //             }
    //           } else {
    //             new Notice(`❗️ No file selected.`);
    //           }
    //         });
    //       }),
    //   );

    let imagePreview = contentEl.createEl("img");
    imagePreview.setCssStyles({
      maxWidth: "100%",
      display: "none",
    });

    const imageNameDiv = contentEl.createEl("div");
    imageNameDiv.setCssStyles({
      display: "none",
    });

    const clearImageButton = contentEl.createEl("div");
    clearImageButton.setCssStyles({
      display: "none",
      background: "none",
      border: "none",
      cursor: "pointer",
      fontSize: "14px",
      color: "red",
    });

    clearImageButton.textContent = "❌ Remove image.";

    function clearSelectedImage() {
      // image = null;
      imagePreview.src = "";
      imagePreview.style.display = "none";
      imageNameDiv.textContent = "";
      imageNameDiv.style.display = "none";
      clearImageButton.style.display = "none";
    }

    clearImageButton.addEventListener("click", clearSelectedImage);

    titleText.inputEl.setCssStyles({
      width: "100%",
      marginBottom: "10px",
    });

    summaryText.inputEl.setCssStyles({
      width: "100%",
      height: "75px",
      marginBottom: "10px",
    });

    tagsText.inputEl.setCssStyles({
      width: "100%",
    });

    tagsText.inputEl.addClass("features");

    contentEl.createEl("hr");

    let info = contentEl.createEl("p", {
      text: `Are you sure you want to publish this article to Nostr?`,
    });
    info.addClass("publish-modal-info");

    const isUpdate =
      !!frontmatter?.pubkey &&
      !!frontmatter?.identifier &&
      this.plugin.events.hasReplaceable(
        kinds.LongFormArticle,
        frontmatter.pubkey,
        frontmatter.identifier,
      );

    let publishButton = new ButtonComponent(contentEl)
      .setButtonText(isUpdate ? "Update Article" : "Publish Article")
      .setCta()
      .onClick(async () => {
        // Get final values
        const title = titleText.getValue();
        const summary = summaryText.getValue();
        const image = properties.image;
        const identifier = properties.identifier;
        const published_at = properties.published_at;
        const pubkey =
          frontmatter?.pubkey || this.plugin.accounts.active?.pubkey;

        if (relays.length === 0) {
          new Notice("❌ No relays found.");
          return;
        }
        if (!pubkey) {
          new Notice("❌ No active nostr account.");
          return;
        }

        let originalContent: string | undefined;
        try {
          publishButton.setDisabled(true).setButtonText("Saving changes...");

          // Save frontmatter changes
          await this.app.fileManager.processFrontMatter(this.file, (fm) => {
            fm.title = title;
            fm.pubkey = pubkey;
            if (summary) fm.summary = summary;
            if (image) fm.image = image;
            if (hashtags.length > 0) fm.tags = hashtags;
            fm.identifier = identifier;
            fm.published_at = published_at;
          });

          const uploads = new Map<EmbedCache, BlobDescriptor>();
          let processedContent: string | undefined;
          if (uploadMedia) {
            if (servers.length === 0) {
              new Notice("❌ No media servers found.");
              return;
            }

            // Process content in memory to convert image wikilinks to markdown images
            publishButton.setButtonText("Processing wikilinks...");
            processedContent = await this.plugin.publisher.getProcessedContent(
              this.file,
            );

            // Get embeds from both original file and processed content
            const originalEmbeds =
              this.plugin.publisher.getArticleEmbeddedMedia(this.file) || [];
            const processedEmbeds =
              this.plugin.publisher.getEmbeddedMediaFromContent(
                processedContent,
                this.file,
              );

            // Combine both sets of embeds
            const embeds = [...originalEmbeds, ...processedEmbeds];

            if (embeds && embeds?.length > 0) {
              publishButton.setButtonText("Uploading media...");

              for (const media of embeds) {
                new Notice(
                  `Uploading ${media.link} to ${servers.length} servers...`,
                );

                const blob = await this.plugin.publisher.uploadMediaEmbed(
                  this.file,
                  media,
                  servers,
                );

                uploads.set(media, blob);
              }
            }
          }

          const draft = await this.plugin.publisher.createArticleDraft(
            this.file,
            uploads,
            processedContent,
          );

          publishButton.setButtonText("Signing...");
          const signed = await this.plugin.publisher.signArticleDraft(draft);

          publishButton.setButtonText("Publishing...");
          const results = await this.plugin.publisher.publishArticle(signed);

          new Notice(
            `Published to ${results.filter((r) => r.ok).length} relays.`,
          );

          this.close();
        } catch (error) {
          console.error(error);
          if (error instanceof Error) new Notice(`❌ ${error.message}`);
          else new Notice(`❌ Failed to publish article to Nostr.`);
        }
        publishButton.setButtonText("Confirm and Publish").setDisabled(false);
        this.close();
      });

    contentEl.classList.add("publish-modal-content");
    publishButton.buttonEl.classList.add("publish-modal-button");
    summaryText.inputEl.classList.add("publish-modal-input");

    function createPillElement(tag: string) {
      const pillElement = document.createElement("div");
      pillElement.className = "pill";
      pillElement.textContent = tag;

      const deleteButton = document.createElement("div");
      deleteButton.className = "delete-button";
      deleteButton.textContent = "x";

      deleteButton.addEventListener("click", () => {
        hashtags = hashtags.filter((t) => t !== tag);
        pillElement.remove();
      });

      pillElement.appendChild(deleteButton);
      return pillElement;
    }

    function addTagAsPill(tag: string) {
      if (tag.trim() === "") return;
      hashtags.push(tag.trim());
      const pillElement = createPillElement(tag.trim());
      pillsContainer.appendChild(pillElement);
      tagsText.setValue("");
    }
  }

  onClose(): void {
    for (const sub of this.cleanup) sub.unsubscribe();
    this.cleanup = [];
  }
}

function isValidURL(url: string) {
  try {
    new URL(url);
    return true;
  } catch (_) {
    return false;
  }
}
