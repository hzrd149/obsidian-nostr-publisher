import { isHexKey } from "applesauce-core/helpers";
import { nip19 } from "nostr-tools";
import { hexToArrayBuffer } from "obsidian";

export function normalizePrivateKey(key: string): Uint8Array {
  if (isHexKey(key)) return new Uint8Array(hexToArrayBuffer(key));

  const decode = nip19.decode(key);
  if (decode.type === "nsec") return decode.data;

  throw new Error("Invalid private key");
}
