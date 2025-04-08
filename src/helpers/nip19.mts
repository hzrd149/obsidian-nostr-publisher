import { getPubkeyFromDecodeResult, isHexKey } from "applesauce-core/helpers";
import { nip19 } from "nostr-tools";
import { AddressPointer, ProfilePointer } from "nostr-tools/nip19";
import { hexToArrayBuffer } from "obsidian";

export function normalizePrivateKey(key: string): Uint8Array {
  if (isHexKey(key)) return new Uint8Array(hexToArrayBuffer(key));

  const decode = nip19.decode(key);
  if (decode.type === "nsec") return decode.data;

  throw new Error("Invalid private key");
}

/**
 * Normalizes a string to a nostr public key
 * @param key The string to normalize
 * @returns The normalized public key
 */
export function normalizePubkey(key: string): string | undefined {
  try {
    if (isHexKey(key)) return key;
    const decode = nip19.decode(key);
    return getPubkeyFromDecodeResult(decode);
  } catch (error) {
    return undefined;
  }
}

/**
 * Normalizes a string to a nostr profile pointer
 * @param input The string to normalize
 * @returns The normalized profile pointer
 */
export function normalizeInputToProfilePointer(
  input: string,
): ProfilePointer | null {
  if (isHexKey(input)) return { pubkey: input };

  try {
    const decode = nip19.decode(input);
    switch (decode.type) {
      case "npub":
        return { pubkey: decode.data };
      case "nprofile":
        return decode.data;
    }
  } catch (err) {}

  return null;
}

/**
 * Extracts an AddressPointer from various input formats
 * @param input AddressPointer, naddr1..., or URL containing a reference to a Nostr article
 * @returns The normalized AddressPointer
 */
export function getAddressPointerFromInput(
  input: string,
): AddressPointer | null {
  // Check if it's a hex event ID
  if (/^[a-f0-9]{64}$/i.test(input)) return null;

  // Check if it's a naddr1... address
  if (input.startsWith("naddr1")) {
    try {
      const decoded = nip19.decode(input);
      if (decoded.type === "naddr") {
        return decoded.data;
      }
    } catch (error) {
      return null;
    }
  }

  // Check if it's a URL with a nostr address
  try {
    const url = new URL(input);
    // Check for common patterns in URLs
    const pathname = url.pathname;
    const match = pathname.match(/naddr1[a-zA-Z0-9]+/);
    if (match) return getAddressPointerFromInput(match[0]);
  } catch (error) {}

  return null;
}
