import { normalizeURL } from "applesauce-core/helpers";
import { EventFactoryClient } from "applesauce-factory";

export const DEFAULT_FALLBACK_RELAYS = [
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://relayable.org",
  "wss://nostr.rocks",
  "wss://nostr.fmt.wiz.biz",
].map(normalizeURL);

export const DEFAULT_LOOKUP_RELAYS = ["wss://purplepag.es"].map(normalizeURL);

export const NOSTR_CLIENT: EventFactoryClient = {
  name: "nsotr-writer",
};
