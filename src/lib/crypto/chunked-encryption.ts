/**
 * Chunked file encryption — client-side only.
 *
 * Splits files into fixed-size chunks, encrypts each independently.
 * Each chunk is authenticated with its sequence number and isLastChunk flag
 * to prevent reordering and truncation attacks.
 */

import nacl from "tweetnacl";
import { toBase64, fromBase64, randomBytes } from "./utils";

export const CHUNK_SIZE = 50 * 1024 * 1024; // 50 MB per chunk
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

  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(authPayload, nonce, sessionKey);

  if (!ciphertext) throw new Error(`Chunk ${index} encryption failed`);

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
  const plaintext = nacl.secretbox.open(ciphertext, nonce, sessionKey);

  if (!plaintext) throw new Error(`Chunk ${expectedIndex} decryption failed`);

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
