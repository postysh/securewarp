/**
 * Web Worker for off-main-thread file metadata decryption.
 *
 * Receives batches of encrypted file rows + the user's private key,
 * runs the full unwrap chain (privHierKey → sessionKey → metadata),
 * and returns decrypted results. The main thread stays responsive
 * while the worker crunches crypto.
 *
 * Security: the worker receives the user's encryptionPrivateKey via
 * postMessage. This is the same key that lives in sessionStorage on
 * the main thread — the worker has no additional access beyond what
 * the page already holds. The key is NOT persisted by the worker.
 */

import nacl from "tweetnacl";
import { fromBase64, toBase64 } from "./utils";

// Inline the unwrap functions to avoid import issues in worker context

function unwrapPrivHier(
  encryptedPrivHier: string,
  wrappedByPublicKey: string,
  recipientPrivateKey: string
): string {
  const combined = fromBase64(encryptedPrivHier);
  const nonce = combined.slice(0, nacl.box.nonceLength);
  const ciphertext = combined.slice(nacl.box.nonceLength);
  const senderPub = fromBase64(wrappedByPublicKey);
  const recipientSec = fromBase64(recipientPrivateKey);
  const plaintext = nacl.box.open(ciphertext, nonce, senderPub, recipientSec);
  if (!plaintext) throw new Error("Unwrap priv hier failed");
  return toBase64(plaintext);
}

function unwrapSessionKey(
  encSessionKey: string,
  sessionKeyNonce: string,
  ownerPublicKey: string,
  privateHierarchicalKey: string
): Uint8Array {
  const ciphertext = fromBase64(encSessionKey);
  const nonce = fromBase64(sessionKeyNonce);
  const senderPub = fromBase64(ownerPublicKey);
  const recipientSec = fromBase64(privateHierarchicalKey);
  const plaintext = nacl.box.open(ciphertext, nonce, senderPub, recipientSec);
  if (!plaintext) throw new Error("Unwrap session key failed");
  return plaintext;
}

function decryptMeta(
  encrypted: { nonce: string; ciphertext: string },
  sessionKey: Uint8Array
): { name: string; type: string; size: number } {
  const nonce = fromBase64(encrypted.nonce);
  const ciphertext = fromBase64(encrypted.ciphertext);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, sessionKey);
  if (!plaintext) throw new Error("Metadata decrypt failed");
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export interface DecryptRequest {
  id: number;
  files: {
    fileId: string;
    encryptedPrivHier: string;
    wrappedByPublicKey: string;
    ownerPublicKey: string;
    encSessionKeyByFile: string;
    sessionKeyNonce: string;
    encryptedMetadata: string;
    publicHierarchicalKey: string;
    isFolder: boolean;
  }[];
  encryptionPrivateKey: string;
}

export interface DecryptResult {
  id: number;
  results: {
    fileId: string;
    name: string;
    type: string;
    size: number;
    privHier?: string;
    publicHierarchicalKey?: string;
    isFolder: boolean;
  }[];
}

// Worker entry point
self.onmessage = (e: MessageEvent<DecryptRequest>) => {
  const { id, files, encryptionPrivateKey } = e.data;
  const results: DecryptResult["results"] = [];

  for (const f of files) {
    try {
      if (!f.encryptedPrivHier) continue;
      const privHier = unwrapPrivHier(f.encryptedPrivHier, f.wrappedByPublicKey, encryptionPrivateKey);
      const sk = unwrapSessionKey(f.encSessionKeyByFile, f.sessionKeyNonce, f.ownerPublicKey, privHier);
      const encMeta = typeof f.encryptedMetadata === "string" ? JSON.parse(f.encryptedMetadata) : f.encryptedMetadata;
      const meta = decryptMeta(encMeta, sk);
      sk.fill(0);
      results.push({
        fileId: f.fileId,
        name: meta.name,
        type: meta.type,
        size: meta.size,
        privHier: f.isFolder ? privHier : undefined,
        publicHierarchicalKey: f.isFolder ? f.publicHierarchicalKey : undefined,
        isFolder: f.isFolder,
      });
    } catch {
      results.push({
        fileId: f.fileId,
        name: "[Encrypted]",
        type: "unknown",
        size: 0,
        isFolder: f.isFolder,
      });
    }
  }

  self.postMessage({ id, results });
};
