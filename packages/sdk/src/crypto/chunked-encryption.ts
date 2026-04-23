/**
 * Chunked file encryption — client-side only.
 *
 * Splits files into fixed-size chunks, encrypts each independently.
 * Each chunk is authenticated with its sequence number and isLastChunk flag
 * to prevent reordering and truncation attacks.
 *
 * AEAD: XChaCha20-Poly1305 via `@noble/ciphers` (crypto v2; replaced
 * xsalsa20-poly1305 in 2026-04-20). Same 32-byte key + 24-byte nonce,
 * so the chunk header format + storage layout are unchanged.
 */

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { toBase64, fromBase64, randomBytes } from "./utils";

const SECRETBOX_NONCE_LEN = 24;

// 8 MB per chunk. Middle ground between Proton's 4 MB (retry-friendly,
// mobile-RAM-friendly) and WeTransfer's 15 MB (throughput-tuned). We
// briefly tried 16 MB looking for TCP slow-start amortization but HAR
// measurements showed aggregate throughput was unchanged — the true
// ceiling is the single HTTP/2 TCP connection to R2 (~15 MB/s for the
// WNAM route), not per-chunk overhead. 8 MB halves the retry cost of
// a failed chunk with no throughput penalty.
//
// Not a ciphertext-layout change — existing files in R2 keep whatever
// chunk size they were uploaded with; decrypt iterates over the
// per-chunk DB manifest, not this constant. Only new uploads use the
// new size.
export const CHUNK_SIZE = 8 * 1024 * 1024;
export const MAX_FILE_SIZE_FREE = 100 * 1024 * 1024; // 100 MB for free tier
export const MAX_FILE_SIZE_PRO = 5 * 1024 * 1024 * 1024; // 5 GB for pro tier
// Matched to `SHARD_COUNT` in src/lib/db/r2.ts so each in-flight chunk
// at steady state hits a distinct bucket hostname (→ a distinct TCP
// connection). Bumping this WITHOUT bumping the shard count just
// multiplexes more streams onto the existing connections without
// improving aggregate bandwidth — the whole reason we sharded. Keep
// the two constants in sync.
//
// In-flight RAM: N × CHUNK_SIZE = 5 × 8 MB = 40 MB per upload. Fine
// on desktop and mobile. See r2.ts for why 5 rather than 15.
export const CONCURRENT_CHUNK_UPLOADS = 5;

export interface EncryptedChunk {
  index: number;
  isFinal: boolean;
  ciphertext: Uint8Array;
  nonce: string; // base64
  sizeBytes: number;
}

/**
 * Split a file into chunks using a generator for memory efficiency.
 * Only one chunk is in memory at a time.
 */
/**
 * Encrypt a single chunk with the session key.
 * Prepends authentication data (sequence + isFinal) to prevent reordering attacks.
 */
export function encryptChunk(
  chunkData: Uint8Array,
  index: number,
  isFinal: boolean,
  sessionKey: Uint8Array
): EncryptedChunk {
  // Create authenticated payload: [4 bytes sequence][1 byte isFinal][chunk data]
  const authPayload = new Uint8Array(5 + chunkData.length);
  const view = new DataView(authPayload.buffer);
  view.setUint32(0, index, true); // little-endian sequence number
  authPayload[4] = isFinal ? 1 : 0;
  authPayload.set(chunkData, 5);

  const nonce = randomBytes(SECRETBOX_NONCE_LEN);
  const ciphertext = xchacha20poly1305(sessionKey, nonce).encrypt(authPayload);

  return {
    index,
    isFinal,
    ciphertext,
    nonce: toBase64(nonce),
    sizeBytes: ciphertext.length,
  };
}

/**
 * Decrypt a single chunk and verify its sequence number and isFinal flag.
 */
export function decryptChunk(
  ciphertext: Uint8Array,
  nonceB64: string,
  expectedIndex: number,
  expectedFinal: boolean,
  sessionKey: Uint8Array
): Uint8Array {
  const nonce = fromBase64(nonceB64);
  // `.decrypt()` throws with "invalid tag" on Poly1305 mismatch. Wrap
  // with the historical "Chunk N decryption failed" message so callers
  // and tests have a stable surface string.
  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(sessionKey, nonce).decrypt(ciphertext);
  } catch {
    throw new Error(`Chunk ${expectedIndex} decryption failed`);
  }

  // Verify authentication data
  const view = new DataView(plaintext.buffer, plaintext.byteOffset);
  const sequence = view.getUint32(0, true);
  const isFinal = plaintext[4] === 1;

  if (sequence !== expectedIndex) {
    throw new Error(`Chunk reordering detected: expected ${expectedIndex}, got ${sequence}`);
  }
  if (isFinal !== expectedFinal) {
    throw new Error(`Chunk truncation detected at chunk ${expectedIndex}`);
  }

  // Return just the data (without the 5-byte auth header)
  return plaintext.slice(5);
}

/**
 * Get the number of chunks for a file.
 */
export function getChunkCount(fileSize: number): number {
  return Math.ceil(fileSize / CHUNK_SIZE);
}
