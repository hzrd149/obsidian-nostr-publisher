import { nanoid } from "nanoid";
import { NostrEvent } from "nostr-tools";
import { NostrFrontmatter } from "../schema/frontmatter.mjs";
import { getReplaceableIdentifier } from "applesauce-core/helpers";

/**
 * Extracts metadata from a Nostr article event
 * @param event The Nostr event
 * @returns Article metadata
 */
export function extractNostrArticleFrontmatter(
  event: NostrEvent,
): NostrFrontmatter {
  const frontmatter: NostrFrontmatter = {
    pubkey: event.pubkey,
    identifier: getReplaceableIdentifier(event),
    // default to the event creation time
    published_at: event.created_at,
  };

  // Extract title, summary, and image from tags
  for (const tag of event.tags) {
    if (tag[0] === "title" && tag[1]) {
      frontmatter.title = tag[1];
    } else if (tag[0] === "summary" && tag[1]) {
      frontmatter.summary = tag[1];
    } else if (tag[0] === "image" && tag[1]) {
      frontmatter.image = tag[1];
    } else if (tag[0] === "t") {
      if (!frontmatter.tags) frontmatter.tags = [];
      frontmatter.tags.push(tag[1]);
    } else if (tag[0] === "published_at" && tag[1]) {
      frontmatter.published_at = parseInt(tag[1], 10);
    }
  }

  // If no title is found, try to extract it from the first heading in the content
  if (!frontmatter.title) {
    const headingMatch = event.content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      frontmatter.title = headingMatch[1].trim();
    }
  }

  if (!frontmatter.title) {
    frontmatter.title = getReplaceableIdentifier(event);
  }

  return frontmatter;
}

/**
 * Generates a unique filename for an image based on its URL
 * @param url The image URL
 * @returns A unique filename
 */
export function generateImageFilename(url: string): string {
  try {
    // Try to extract a filename from the URL
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const originalFilename = pathname.split("/").pop() || "";

    // If there's a valid filename with extension, use it
    if (originalFilename && originalFilename.includes(".")) {
      return originalFilename;
    }
  } catch (error) {
    // URL parsing failed, continue with fallback
  }

  // Fallback: random uid
  const hash = nanoid();

  // Try to determine extension from URL
  let extension = "jpg"; // Default extension
  if (url.includes(".png")) extension = "png";
  else if (url.includes(".gif")) extension = "gif";
  else if (url.includes(".webp")) extension = "webp";
  else if (url.includes(".jpeg")) extension = "jpeg";

  return `${hash}.${extension}`;
}
