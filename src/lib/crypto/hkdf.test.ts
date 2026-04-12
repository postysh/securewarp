import { describe, it, expect } from "vitest";
import { splitMasterKey } from "./hkdf";
import { toBase64 } from "./utils";

describe("splitMasterKey", () => {
  const masterKey = new Uint8Array(32).fill(7);

  it("derives three distinct 32-byte keys", () => {
    const { srpKey, passwordDerivedSecret, unlockCacheKey } = splitMasterKey(masterKey);
    expect(srpKey.length).toBe(32);
    expect(passwordDerivedSecret.length).toBe(32);
    expect(unlockCacheKey.length).toBe(32);
    expect(toBase64(srpKey)).not.toBe(toBase64(passwordDerivedSecret));
    expect(toBase64(srpKey)).not.toBe(toBase64(unlockCacheKey));
    expect(toBase64(passwordDerivedSecret)).not.toBe(toBase64(unlockCacheKey));
  });

  it("is deterministic for the same master key", () => {
    const first = splitMasterKey(masterKey);
    const second = splitMasterKey(masterKey);
    expect(toBase64(first.srpKey)).toBe(toBase64(second.srpKey));
    expect(toBase64(first.passwordDerivedSecret)).toBe(toBase64(second.passwordDerivedSecret));
    expect(toBase64(first.unlockCacheKey)).toBe(toBase64(second.unlockCacheKey));
  });

  it("produces different output for different master keys", () => {
    const other = new Uint8Array(32).fill(8);
    const a = splitMasterKey(masterKey);
    const b = splitMasterKey(other);
    expect(toBase64(a.srpKey)).not.toBe(toBase64(b.srpKey));
    expect(toBase64(a.passwordDerivedSecret)).not.toBe(toBase64(b.passwordDerivedSecret));
    expect(toBase64(a.unlockCacheKey)).not.toBe(toBase64(b.unlockCacheKey));
  });
});
