import {
  AUDIO_EXT,
  IMAGE_EXT,
  normalizeURL,
  VIDEO_EXT,
} from "applesauce-core/helpers";

export const DEFAULT_PLUGIN_RELAYS = [].map(normalizeURL);

export const DEFAULT_LOOKUP_RELAYS = ["wss://purplepag.es", 'wss://index.hzrd149.com'].map(normalizeURL);

export const DEFAULT_CONNECT_RELAY = normalizeURL("wss://relay.nsec.app");

export const UPLOAD_MEDIA_EXT = [...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT];

/** Maps a file extension to a mime type for Blossom uploads */
export const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  "3gp": "video/3gpp",
};
