/**
 * Byte / encoding helpers shared across the SDK's crypto modules.
 *
 * History: these originally delegated to `tweetnacl` + `tweetnacl-util`
 * for base64 / UTF-8 / CSPRNG. Crypto v2 swapped the primitive layer to
 * `@noble/ciphers` + `@noble/curves` (XChaCha20-Poly1305, X25519, Ed25519).
 * The public signatures here are unchanged so downstream callers didn't
 * need to touch anything — only the implementation underneath rotated.
 *
 * `randomBytes` delegates to noble, which uses Web Crypto's
 * `crypto.getRandomValues` on browsers + Workers (and Node 20+ via
 * `globalThis.crypto`). Both are CSPRNGs.
 */

import {
  randomBytes as nobleRandomBytes,
  utf8ToBytes,
  bytesToUtf8,
} from "@noble/ciphers/utils.js";

export function toBase64(bytes: Uint8Array): string {
  // Chunk the byte → char conversion so `String.fromCharCode.apply` doesn't
  // blow the JS call-stack on large inputs (browsers cap apply args at
  // roughly 65k–125k depending on engine; ciphertext chunks can be 16 MB+).
  let binary = "";
  const CHUNK = 0x8000; // 32 KiB — safely below every engine's cap.
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}

export function fromBase64(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

export function randomBytes(length: number): Uint8Array {
  return nobleRandomBytes(length);
}

export function utf8Encode(str: string): Uint8Array {
  return utf8ToBytes(str);
}

export function utf8Decode(bytes: Uint8Array): string {
  return bytesToUtf8(bytes);
}
