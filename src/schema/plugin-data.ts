import z from "zod";
import { DEFAULT_FALLBACK_RELAYS, DEFAULT_LOOKUP_RELAYS } from "../const";

const NostrPluginData = z.object({
  active: z.string().optional(),
  accounts: z.array(z.any()).default([]),
  fallbackRelays: z.array(z.string()).default(DEFAULT_FALLBACK_RELAYS),
  lookupRelays: z.array(z.string()).default(DEFAULT_LOOKUP_RELAYS),
});

export type TNostrPluginData = z.infer<typeof NostrPluginData>;
export default NostrPluginData;
