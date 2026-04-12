/**
 * IndexedDB cache for decrypted file metadata, encrypted at rest
 * under the user's unlockCacheKey. Folders load instantly on
 * return visits without any server call.
 *
 * Lifecycle: same as lock-cache — cleared on logout and password
 * change. Encrypted so an attacker with disk access sees only
 * ciphertext.
 */

import nacl from "tweetnacl";
import { sha256 } from "@noble/hashes/sha2.js";
import { toBase64, fromBase64, randomBytes } from "@/lib/crypto/utils";

const DB_NAME = "securewarp_metadata_cache";
const STORE_NAME = "entries";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Encrypt a JSON-serializable value under the given key */
function seal(data: unknown, key: Uint8Array): string {
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(plaintext, nonce, key);
  return toBase64(nonce) + "." + toBase64(ciphertext);
}

/** Decrypt a sealed value */
function unseal<T>(sealed: string, key: Uint8Array): T | null {
  try {
    const [nonceB64, ctB64] = sealed.split(".");
    const nonce = fromBase64(nonceB64);
    const ciphertext = fromBase64(ctB64);
    const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
    if (!plaintext) return null;
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
}

export interface CachedFileEntry {
  id: string;
  name: string;
  type: string;
  size: number;
  isFolder: boolean;
  parentId: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Derive a 32-byte cache encryption key from the user's private
 * encryption key. Deterministic so the same user always gets the
 * same cache key without storing it separately.
 */
export function deriveCacheKey(encryptionPrivateKey: string): Uint8Array {
  const input = new TextEncoder().encode("securewarp-idb-cache-v1:" + encryptionPrivateKey);
  return sha256(input);
}

let dbInstance: IDBDatabase | null = null;

async function getDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await openDB();
  return dbInstance;
}

/**
 * Get cached file list for a folder.
 * Returns null if cache miss or decryption fails.
 */
export async function getCachedFiles(
  cacheKey: string,
  encryptionKey: Uint8Array
): Promise<CachedFileEntry[] | null> {
  try {
    const db = await getDB();
    const sealed = await idbGet(db, cacheKey);
    if (!sealed) return null;
    return unseal<CachedFileEntry[]>(sealed, encryptionKey);
  } catch {
    return null;
  }
}

/**
 * Store file list in cache, encrypted at rest.
 */
export async function setCachedFiles(
  cacheKey: string,
  files: CachedFileEntry[],
  encryptionKey: Uint8Array
): Promise<void> {
  try {
    const db = await getDB();
    const sealed = seal(files, encryptionKey);
    await idbPut(db, cacheKey, sealed);
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Clear all cached metadata. Called on logout and password change.
 */
export async function clearMetadataCache(): Promise<void> {
  try {
    const db = await getDB();
    await idbClear(db);
  } catch {
    // Non-fatal
  }
}
