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
 *
 * Crypto v2: uses the SDK's `unwrapPrivateHierarchicalKey` +
 * `unwrapSessionKeyFromFile` + `decryptMetadata` directly rather than
 * inlining. The previous "avoid import issues in worker context"
 * concern was pre-SDK-extraction; now that crypto lives in
 * `@securewarp/sdk`, standard ES-module imports work in Workers too.
 */

import {
  unwrapPrivateHierarchicalKey,
  unwrapSessionKeyFromFile,
  decryptMetadata,
  type HybridPrivateKeys,
} from "@/lib/crypto/file-crypto";

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
    publicKemHierarchicalKey: string;
    isFolder: boolean;
  }[];
  encryptionPrivateKey: string;
  kemPrivateKey: string;
}

export interface DecryptResult {
  id: number;
  results: {
    fileId: string;
    name: string;
    type: string;
    size: number;
    privHier?: HybridPrivateKeys;
    publicHierarchicalKey?: string;
    publicKemHierarchicalKey?: string;
    isFolder: boolean;
  }[];
}

// Worker entry point
self.onmessage = (e: MessageEvent<DecryptRequest>) => {
  const { id, files, encryptionPrivateKey, kemPrivateKey } = e.data;
  const results: DecryptResult["results"] = [];

  for (const f of files) {
    let sk: Uint8Array | null = null;
    try {
      if (!f.encryptedPrivHier) continue;
      const privHier = unwrapPrivateHierarchicalKey(
        f.encryptedPrivHier,
        f.wrappedByPublicKey,
        encryptionPrivateKey,
        kemPrivateKey,
      );
      sk = unwrapSessionKeyFromFile(
        f.encSessionKeyByFile,
        f.sessionKeyNonce,
        f.ownerPublicKey,
        privHier,
      );
      const encMeta =
        typeof f.encryptedMetadata === "string"
          ? JSON.parse(f.encryptedMetadata)
          : f.encryptedMetadata;
      const meta = decryptMetadata(encMeta, sk);
      results.push({
        fileId: f.fileId,
        name: meta.name,
        type: meta.type,
        size: meta.size,
        privHier: f.isFolder ? privHier : undefined,
        publicHierarchicalKey: f.isFolder ? f.publicHierarchicalKey : undefined,
        publicKemHierarchicalKey: f.isFolder ? f.publicKemHierarchicalKey : undefined,
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
    } finally {
      if (sk) sk.fill(0);
    }
  }

  self.postMessage({ id, results });
};
