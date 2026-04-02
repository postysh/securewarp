/**
 * File encryption — client-side only.
 *
 * Each file gets a unique random session key.
 * File content is encrypted with xsalsa20-poly1305 (secretbox).
 * The session key is encrypted with the user's public encryption key (box).
 * Metadata (filename, type, size) is encrypted with the session key.
 */

import nacl from "tweetnacl";
import { toBase64, fromBase64, randomBytes } from "./utils";

export interface EncryptedFile {
  encryptedContent: Uint8Array;  // raw ciphertext to upload to R2
  nonce: string;                 // base64
  sessionKey: string;            // base64 — the raw session key (encrypt this per-user)
}

export interface EncryptedMetadata {
  nonce: string;      // base64
  ciphertext: string; // base64
}

/**
 * Generate a random session key for a file.
 */
export function generateSessionKey(): Uint8Array {
  return randomBytes(nacl.secretbox.keyLength);
}

/**
 * Encrypt file content with a session key.
 */
export function encryptFileContent(content: Uint8Array, sessionKey: Uint8Array): {
  ciphertext: Uint8Array;
  nonce: string;
} {
  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(content, nonce, sessionKey);

  if (!ciphertext) throw new Error("File encryption failed");

  return {
    ciphertext,
    nonce: toBase64(nonce),
  };
}

/**
 * Decrypt file content with a session key.
 */
export function decryptFileContent(ciphertext: Uint8Array, nonceB64: string, sessionKey: Uint8Array): Uint8Array {
  const nonce = fromBase64(nonceB64);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, sessionKey);

  if (!plaintext) throw new Error("File decryption failed — wrong key or corrupted data");

  return plaintext;
}

/**
 * Encrypt file metadata (name, type, size) with the session key.
 */
export function encryptMetadata(
  metadata: { name: string; type: string; size: number },
  sessionKey: Uint8Array
): EncryptedMetadata {
  const payload = JSON.stringify(metadata);
  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const messageBytes = new TextEncoder().encode(payload);
  const ciphertext = nacl.secretbox(messageBytes, nonce, sessionKey);

  if (!ciphertext) throw new Error("Metadata encryption failed");

  return {
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
  };
}

/**
 * Decrypt file metadata with the session key.
 */
export function decryptMetadata(
  encrypted: EncryptedMetadata,
  sessionKey: Uint8Array
): { name: string; type: string; size: number } {
  const nonce = fromBase64(encrypted.nonce);
  const ciphertext = fromBase64(encrypted.ciphertext);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, sessionKey);

  if (!plaintext) throw new Error("Metadata decryption failed");

  return JSON.parse(new TextDecoder().decode(plaintext));
}

/**
 * Encrypt a session key for a specific user using their public encryption key (box).
 * This is asymmetric — only the user with the matching private key can decrypt.
 */
export function encryptSessionKeyForUser(
  sessionKey: Uint8Array,
  recipientPublicKey: string, // base64
  senderPrivateKey: string    // base64
): string {
  const pubKey = fromBase64(recipientPublicKey);
  const privKey = fromBase64(senderPrivateKey);
  const nonce = randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(sessionKey, nonce, pubKey, privKey);

  if (!encrypted) throw new Error("Session key encryption failed");

  // Combine nonce + ciphertext into a single base64 string
  const combined = new Uint8Array(nonce.length + encrypted.length);
  combined.set(nonce);
  combined.set(encrypted, nonce.length);

  return toBase64(combined);
}

/**
 * Decrypt a session key using the user's private encryption key.
 */
export function decryptSessionKey(
  encryptedSessionKey: string, // base64 (nonce + ciphertext)
  senderPublicKey: string,     // base64
  recipientPrivateKey: string  // base64
): Uint8Array {
  const combined = fromBase64(encryptedSessionKey);
  const nonce = combined.slice(0, nacl.box.nonceLength);
  const ciphertext = combined.slice(nacl.box.nonceLength);
  const pubKey = fromBase64(senderPublicKey);
  const privKey = fromBase64(recipientPrivateKey);

  const sessionKey = nacl.box.open(ciphertext, nonce, pubKey, privKey);

  if (!sessionKey) throw new Error("Session key decryption failed — wrong key");

  return sessionKey;
}
