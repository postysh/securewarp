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

// 4 MB per chunk. Matches Proton Drive's block size almost exactly.
// Smaller chunks are better for three reasons: (a) each chunk finishes
// in a few seconds even on slow uplinks, so the R2 presigned-URL TTL
// never becomes the bottleneck; (b) a transient failure re-sends 4 MB
// instead of 50 MB; (c) progress bars move every few seconds instead
// of every minute on large files.
//
// Not a ciphertext-layout change — existing files in R2 keep whatever
// chunk size they were uploaded with; decrypt iterates over the
// per-chunk DB manifest, not this constant. Only new uploads use the
// new size.
export const CHUNK_SIZE = 4 * 1024 * 1024;
export const MAX_FILE_SIZE_FREE = 100 * 1024 * 1024; // 100 MB for free tier
export const MAX_FILE_SIZE_PRO = 5 * 1024 * 1024 * 1024; // 5 GB for pro tier
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
export async function* fileChunkGenerator(file: File): AsyncGenerator<{ data: Uint8Array; index: number; isFinal: boolean }> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const slice = file.slice(start, end);
    const buffer = await slice.arrayBuffer();

    yield {
      data: new Uint8Array(buffer),
      index: i,
      isFinal: i === totalChunks - 1,
    };
  }
}

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
