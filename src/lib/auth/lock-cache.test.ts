import { describe, it, expect, beforeEach } from "vitest";
import {
  saveLockCache,
  readLockCacheMeta,
  unlockKeys,
  clearLockCache,
} from "./lock-cache";
import { randomBytes, toBase64 } from "@/lib/crypto/utils";

// Vitest's node environment has no window/localStorage — install a
// minimal shim so the lock-cache module's `typeof window === "undefined"`
// guard lets it through and writes/reads behave like a browser.
function installBrowserStorageShim() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  // @ts-expect-error — intentional shim
  globalThis.window = { localStorage };
}

const keys = {
  encryptionPublicKey: "enc-pub",
  encryptionPrivateKey: "enc-priv",
};

describe("lock-cache", () => {
  beforeEach(() => {
    installBrowserStorageShim();
    clearLockCache();
  });

  it("round-trips keys through seal/unseal", () => {
    const unlockCacheKey = randomBytes(32);
    saveLockCache({
      email: "alice@example.com",
      argon2Salt: toBase64(randomBytes(16)),
      keys,
      unlockCacheKey,
    });

    const payload = unlockKeys(unlockCacheKey);
    expect(payload).toEqual(keys);
  });

  it("exposes non-secret metadata without a key", () => {
    const argon2Salt = toBase64(randomBytes(16));
    saveLockCache({
      email: "bob@example.com",
      argon2Salt,
      keys,
      unlockCacheKey: randomBytes(32),
    });

    const meta = readLockCacheMeta();
    expect(meta).toEqual({ email: "bob@example.com", argon2Salt });
  });

  it("returns null metadata when no blob exists", () => {
    expect(readLockCacheMeta()).toBeNull();
  });

  it("throws on wrong key without leaking plaintext", () => {
    saveLockCache({
      email: "alice@example.com",
      argon2Salt: toBase64(randomBytes(16)),
      keys,
      unlockCacheKey: randomBytes(32),
    });

    const wrongKey = randomBytes(32);
    expect(() => unlockKeys(wrongKey)).toThrow(/Wrong password/);
  });

  it("clear wipes the blob", () => {
    saveLockCache({
      email: "alice@example.com",
      argon2Salt: toBase64(randomBytes(16)),
      keys,
      unlockCacheKey: randomBytes(32),
    });
    expect(readLockCacheMeta()).not.toBeNull();
    clearLockCache();
    expect(readLockCacheMeta()).toBeNull();
    expect(() => unlockKeys(randomBytes(32))).toThrow(/No lock cache/);
  });
});
