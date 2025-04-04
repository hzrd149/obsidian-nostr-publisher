import { normalizeURL } from "applesauce-core/helpers";
import { EventFactoryClient } from "applesauce-factory";

export const DEFAULT_PLUGIN_RELAYS = [].map(normalizeURL);

export const DEFAULT_LOOKUP_RELAYS = ["wss://purplepag.es"].map(normalizeURL);

export const DEFAULT_CONNECT_RELAY = normalizeURL("wss://relay.nsec.app");

export const NOSTR_CLIENT: EventFactoryClient = {
  name: "nsotr-writer",
};
