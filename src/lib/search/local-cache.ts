/**
 * Encrypted local-first search cache.
 *
 * The server never knows what the user is searching for. Every
 * accessible file's decrypted name, path, and workspace context is
 * stored in an IndexedDB database on the user's device, encrypted
 * under a key derived from the session keys. Searches run entirely
 * against this local cache — no /api/search, no HMAC tokens, no
 * server-side index.
 *
 * Why IndexedDB and not sessionStorage:
 *   - sessionStorage is per-tab and tiny (~5 MB). A user with 10k
 *     files would blow past the limit before content indexing.
 *   - IndexedDB is shared across tabs and bounded only by available
 *     disk (tens to hundreds of MB). Also survives tab close within
 *     the same origin, so opening a second tab doesn't rebuild.
 *
 * Why encrypted at rest:
 *   - The cache holds plaintext filenames and (for text/Office
 *     previews) excerpts of body content. A disk-level attacker who
 *     can read IndexedDB files would otherwise see everything we
 *     went to zero-knowledge lengths to hide on the server.
 *   - Encryption key is the same `encryptionPrivateKey` the user
 *     already holds in sessionStorage — derived from their password
 *     via SRP + HKDF + Argon2id. Not persisted on disk separately.
 *
 * Schema (v1):
 *   store `files` keyed by `id` (file UUID). Each row holds the
 *   encrypted blob of { name, type, size, isFolder, parentId,
 *   workspaceId, workspaceName, breadcrumb, updatedAt } plus a
 *   nonce and the owning userEmail for multi-account safety (the
 *   cache is per-email so signing out and into another account
 *   doesn't leak the previous one's entries).
 */

import nacl from "tweetnacl";
import { fromBase64, toBase64, randomBytes } from "@/lib/crypto/utils";

const DB_NAME = "securewarp_search";
const DB_VERSION = 1;
const STORE = "files";
const META_STORE = "meta";

export interface SearchCacheEntry {
  id: string;
  name: string;
  isFolder: boolean;
  type: string;
  size: number;
  parentId: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  // Pre-computed breadcrumb shown in search results, e.g.
  // "My Drive → Projects" or "Acme Team → Engineering → Q4".
  breadcrumb: string;
  updatedAt: string;
}

interface EncryptedRow {
  id: string;
  email: string; // scope key so two accounts in the same browser don't bleed
  nonce: string; // base64
  ciphertext: string; // base64 of JSON-encoded SearchCacheEntry
  updatedAt: string; // indexed for sort/recent queries without decryption
}

// Meta row tracks the last full build so the app can decide whether
// to reuse the cache or rebuild from scratch (account switch, version
// bump, user logged out, etc.).
interface MetaRow {
  email: string;
  builtAt: string;
  version: number;
}

const NONCE_LEN = nacl.secretbox.nonceLength;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("email", "email", { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "email" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("openDb failed"));
  });
}

function tx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  run: (txn: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const txn = db.transaction(stores, mode);
    txn.onerror = () => reject(txn.error ?? new Error("tx failed"));
    Promise.resolve(run(txn)).then(
      (value) => {
        txn.oncomplete = () => resolve(value);
      },
      (err) => reject(err),
    );
  });
}

function deriveKey(encryptionPrivateKeyB64: string): Uint8Array {
  // The user's private encryption key is 32 bytes in nacl.box format.
  // We reuse it directly as the symmetric secretbox key. The key
  // never leaves the client; the cache is unreadable to anyone who
  // doesn't already hold the user's private key (i.e. anyone who
  // couldn't decrypt the files themselves).
  const raw = fromBase64(encryptionPrivateKeyB64);
  return raw.slice(0, 32);
}

function encryptEntry(
  entry: SearchCacheEntry,
  key: Uint8Array,
): { nonce: string; ciphertext: string } {
  const nonce = randomBytes(NONCE_LEN);
  const plaintext = new TextEncoder().encode(JSON.stringify(entry));
  const ciphertext = nacl.secretbox(plaintext, nonce, key);
  if (!ciphertext) throw new Error("Cache encrypt failed");
  return { nonce: toBase64(nonce), ciphertext: toBase64(ciphertext) };
}

function decryptEntry(
  row: EncryptedRow,
  key: Uint8Array,
): SearchCacheEntry | null {
  const nonce = fromBase64(row.nonce);
  const ciphertext = fromBase64(row.ciphertext);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) return null;
  try {
    return JSON.parse(new TextDecoder().decode(plaintext)) as SearchCacheEntry;
  } catch {
    return null;
  }
}

export async function getBuiltAt(email: string): Promise<string | null> {
  try {
    const db = await openDb();
    return await tx(db, [META_STORE], "readonly", (txn) => {
      return new Promise<string | null>((resolve) => {
        const req = txn.objectStore(META_STORE).get(email);
        req.onsuccess = () => {
          const row = req.result as MetaRow | undefined;
          resolve(row?.builtAt ?? null);
        };
        req.onerror = () => resolve(null);
      });
    });
  } catch {
    return null;
  }
}

export async function markBuilt(email: string): Promise<void> {
  try {
    const db = await openDb();
    await tx(db, [META_STORE], "readwrite", (txn) => {
      return new Promise<void>((resolve) => {
        const row: MetaRow = { email, builtAt: new Date().toISOString(), version: 1 };
        const req = txn.objectStore(META_STORE).put(row);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    });
  } catch {
    // Silently ignore — worst case, we rebuild on the next session.
  }
}

export async function replaceAll(
  email: string,
  encryptionPrivateKeyB64: string,
  entries: SearchCacheEntry[],
): Promise<void> {
  const key = deriveKey(encryptionPrivateKeyB64);
  try {
    const db = await openDb();
    await tx(db, [STORE], "readwrite", (txn) => {
      return new Promise<void>((resolve, reject) => {
        const store = txn.objectStore(STORE);
        // Wipe prior entries for this email. Cursor avoids materializing
        // every key into JS.
        const idx = store.index("email");
        const delReq = idx.openCursor(IDBKeyRange.only(email));
        delReq.onerror = () => reject(delReq.error);
        delReq.onsuccess = () => {
          const cursor = delReq.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            // Done deleting — write new entries.
            let pending = entries.length;
            if (pending === 0) {
              resolve();
              return;
            }
            for (const entry of entries) {
              const { nonce, ciphertext } = encryptEntry(entry, key);
              const row: EncryptedRow = {
                id: entry.id,
                email,
                nonce,
                ciphertext,
                updatedAt: entry.updatedAt,
              };
              const putReq = store.put(row);
              putReq.onsuccess = () => {
                pending--;
                if (pending === 0) resolve();
              };
              putReq.onerror = () => reject(putReq.error);
            }
          }
        };
      });
    });
  } finally {
    key.fill(0);
  }
}

export async function upsertOne(
  email: string,
  encryptionPrivateKeyB64: string,
  entry: SearchCacheEntry,
): Promise<void> {
  const key = deriveKey(encryptionPrivateKeyB64);
  try {
    const db = await openDb();
    await tx(db, [STORE], "readwrite", (txn) => {
      return new Promise<void>((resolve, reject) => {
        const { nonce, ciphertext } = encryptEntry(entry, key);
        const row: EncryptedRow = {
          id: entry.id,
          email,
          nonce,
          ciphertext,
          updatedAt: entry.updatedAt,
        };
        const req = txn.objectStore(STORE).put(row);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  } finally {
    key.fill(0);
  }
}

export async function deleteOne(id: string): Promise<void> {
  try {
    const db = await openDb();
    await tx(db, [STORE], "readwrite", (txn) => {
      return new Promise<void>((resolve) => {
        const req = txn.objectStore(STORE).delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    });
  } catch {
    // best-effort
  }
}

export async function clearFor(email: string): Promise<void> {
  try {
    const db = await openDb();
    await tx(db, [STORE, META_STORE], "readwrite", (txn) => {
      return new Promise<void>((resolve) => {
        const store = txn.objectStore(STORE);
        const idx = store.index("email");
        const req = idx.openCursor(IDBKeyRange.only(email));
        req.onerror = () => resolve();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            txn.objectStore(META_STORE).delete(email);
            resolve();
          }
        };
      });
    });
  } catch {
    // best-effort
  }
}

/**
 * Return all entries for `email`, decrypted. Used on each search so
 * the caller can filter / rank in memory. For a few thousand files
 * this is well under a millisecond on any modern device.
 *
 * Returns `[]` if decryption fails (stale key, corrupted blob).
 */
export async function loadAll(
  email: string,
  encryptionPrivateKeyB64: string,
): Promise<SearchCacheEntry[]> {
  const key = deriveKey(encryptionPrivateKeyB64);
  try {
    const db = await openDb();
    return await tx(db, [STORE], "readonly", (txn) => {
      return new Promise<SearchCacheEntry[]>((resolve) => {
        const store = txn.objectStore(STORE);
        const idx = store.index("email");
        const req = idx.getAll(IDBKeyRange.only(email));
        req.onsuccess = () => {
          const rows = (req.result as EncryptedRow[]) ?? [];
          const out: SearchCacheEntry[] = [];
          for (const row of rows) {
            const e = decryptEntry(row, key);
            if (e) out.push(e);
          }
          resolve(out);
        };
        req.onerror = () => resolve([]);
      });
    });
  } catch {
    return [];
  } finally {
    key.fill(0);
  }
}
