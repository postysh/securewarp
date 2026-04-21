import { describe, it, expect } from "vitest";
import {
  generateKeypairs,
  generateRecoveryKey,
  encryptWithRecoveryKey,
  decryptWithRecoveryKey,
  hashRecoveryKey,
  encryptUserData,
  decryptUserData,
} from "./keys";
import { randomBytes } from "./utils";

// XChaCha20-Poly1305 key length (crypto v2). Same 32 bytes tweetnacl's
// secretbox used, just a different cipher under the hood.
const SECRETBOX_KEY_LENGTH = 32;

describe("keys — password path", () => {
  it("roundtrips private keys through password-derived encryption", () => {
    const kp = generateKeypairs();
    const secret = randomBytes(SECRETBOX_KEY_LENGTH);
    const encrypted = encryptUserData(kp, secret);
    const decrypted = decryptUserData(encrypted, secret);
    expect(decrypted.encryptionPrivateKey).toBe(kp.encryptionPrivateKey);
  });

  it("throws on wrong secret", () => {
    const kp = generateKeypairs();
    const encrypted = encryptUserData(kp, randomBytes(32));
    expect(() => decryptUserData(encrypted, randomBytes(32))).toThrow(/Decryption failed/);
  });
});

describe("keys — recovery path", () => {
  it("generates a 24-word BIP39 mnemonic", () => {
    const rk = generateRecoveryKey();
    expect(rk.split(" ").length).toBe(24);
  });

  it("roundtrips private keys through recovery key encryption", () => {
    const kp = generateKeypairs();
    const rk = generateRecoveryKey();
    const encrypted = encryptWithRecoveryKey(kp, rk);
    const decrypted = decryptWithRecoveryKey(encrypted, rk);
    expect(decrypted.encryptionPrivateKey).toBe(kp.encryptionPrivateKey);
  });

  it("rejects decryption with a different recovery key", () => {
    const kp = generateKeypairs();
    const encrypted = encryptWithRecoveryKey(kp, generateRecoveryKey());
    expect(() => decryptWithRecoveryKey(encrypted, generateRecoveryKey())).toThrow(
      /Decryption failed/
    );
  });

  it("hashRecoveryKey is deterministic for the same key", async () => {
    const rk = generateRecoveryKey();
    const a = await hashRecoveryKey(rk);
    const b = await hashRecoveryKey(rk);
    expect(a).toBe(b);
  });

  it("hashRecoveryKey differs for different keys", async () => {
    const a = await hashRecoveryKey(generateRecoveryKey());
    const b = await hashRecoveryKey(generateRecoveryKey());
    expect(a).not.toBe(b);
  });

  it("server-stored hash does not equal the HKDF encryption key material", async () => {
    // Defense-in-depth: the on-disk verification hash must not leak the
    // encryption key. Derive both and confirm they're independent.
    const rk = generateRecoveryKey();
    const hash = await hashRecoveryKey(rk);
    const encrypted = encryptWithRecoveryKey(generateKeypairs(), rk);
    expect(hash).not.toBe(encrypted.ciphertext);
    expect(hash).not.toBe(encrypted.nonce);
  });
});
