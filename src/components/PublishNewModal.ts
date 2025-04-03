import { lastValueFrom, Subscription, toArray } from "rxjs";
import {
  ButtonComponent,
  Modal,
  Notice,
  TFile,
  App,
  TextAreaComponent,
  TextComponent,
} from "obsidian";
import { RelayPool } from "applesauce-relay";
import {
  includeHashtags,
  includeSingletonTag,
  setContent,
} from "applesauce-factory/operations/event";
import { unixNow } from "applesauce-core/helpers";
import { kinds } from "nostr-tools";

import NostrArticlesPlugin from "../../main.js";

export default class ConfirmPublishModal extends Modal {
  plugin: NostrArticlesPlugin;

  private cleanup: Subscription[] = [];

  constructor(
    app: App,
    private pool: RelayPool,
    private file: TFile,
    plugin: NostrArticlesPlugin,
  ) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    let { contentEl } = this;

    const frontmatter = this.app.metadataCache.getFileCache(
      this.file,
    )?.frontmatter;

    if (this.file.extension !== "md") {
      new Notice("❌ Only markdown files can be published.");
      this.close();
      return;
    }

    const frontmatterRegex = /---\s*[\s\S]*?\s*---/g;
    const content = (await this.app.vault.read(this.file))
      .replace(frontmatterRegex, "")
      .trim();

    let hashtags: string[] = [];

    const regex = /#\w+/g;
    const matches = content.match(regex) || [];
    const contentHashtags = matches.map((match: string) => match.slice(1));

    const today = new Date();
    const fallbackIdentifier =
      this.file.basename.replace(/\s/g, "-").toLowerCase() +
      "-" +
      today.toLocaleDateString();

    const properties = {
      title: frontmatter?.title || this.file.basename,
      summary: frontmatter?.summary || "",
      image: isValidURL(frontmatter?.image) ? frontmatter?.image : "",
      tags: frontmatter?.tags || contentHashtags,
      identifier: frontmatter?.identifier || fallbackIdentifier,
      published_at: frontmatter?.published_at || unixNow(),
    };

    for (const tag of properties.tags) {
      hashtags.push(tag);
    }

    this.setTitle("Publish");

    contentEl.createEl("h6", { text: `Title` });
    let titleText = new TextComponent(contentEl)
      .setPlaceholder(`${properties.title}`)
      .setValue(`${properties.title}`);

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

    let relays: string[] = [];
    this.cleanup.push(
      this.plugin.mailboxes.subscribe((mailboxes) => {
        if (mailboxes) relays = mailboxes.outboxes;
      }),
    );

    let publishButton = new ButtonComponent(contentEl)
      .setButtonText("Confirm and Publish")
      .setCta()
      .onClick(async () => {
        if (relays.length === 0) {
          new Notice("❌ No relays found.");
          return;
        }

        if (
          confirm(`Are you sure you want to publish this article to Nostr?`)
        ) {
          // Disable the button and change the text to show a loading state
          publishButton.setButtonText("Publishing...").setDisabled(true);

          try {
            const title = titleText.getValue();
            const summary = summaryText.getValue();
            const image = properties.image;
            const identifier = properties.identifier;
            const published_at = properties.published_at;

            const draft = await this.plugin.factory.build(
              {
                kind: kinds.LongFormArticle,
              },
              includeSingletonTag(["d", identifier], true),
              includeSingletonTag(["title", title], true),
              summary
                ? includeSingletonTag(["summary", summary], true)
                : undefined,
              image ? includeSingletonTag(["image", image], true) : undefined,
              includeSingletonTag(["published_at", String(published_at)]),
              setContent(content),
              includeHashtags(hashtags),
            );

            publishButton.setButtonText("Signing...");

            const signed = await this.plugin.factory.sign(draft);

            publishButton.setButtonText("Saving changes...");

            await this.app.fileManager.processFrontMatter(this.file, (fm) => {
              fm.title = title;
              fm.pubkey = signed.pubkey;
              if (summary) fm.summary = summary;
              if (image) fm.image = image;
              if (hashtags.length > 0) fm.tags = hashtags;
              fm.identifier = identifier;
              fm.published_at = unixNow();
            });

            publishButton.setButtonText("Publishing...");

            const results = await lastValueFrom(
              this.plugin.pool.event(relays, signed).pipe(toArray()),
            );

            new Notice(
              `Published to ${results.filter((r) => r.ok).length} relays.`,
            );

            this.close();
          } catch (error) {
            console.error(error);
            new Notice(`❌ Failed to publish article to Nostr.`);
          }
          publishButton.setButtonText("Confirm and Publish").setDisabled(false);
          this.close();
        }
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
