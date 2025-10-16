import z from "zod";
import { DEFAULT_PLUGIN_RELAYS, DEFAULT_LOOKUP_RELAYS } from "../const.mjs";

const NostrPluginData = z.object({
  active: z.string().optional(),
  accounts: z.array(z.any()).default([]),
  pluginRelays: z.array(z.string()).default(DEFAULT_PLUGIN_RELAYS),
  lookupRelays: z.array(z.string()).default(DEFAULT_LOOKUP_RELAYS),
  localRelay: z.string().default("ws://localhost:4869").optional(),
  mediaDownloadFolder: z.string().default("media"),
});

export type TNostrPluginData = z.infer<typeof NostrPluginData>;
export default NostrPluginData;
