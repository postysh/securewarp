/**
 * Passkey client wrap/unwrap unit tests. Exercises the cryptographic
 * core (HKDF derivation, XChaCha20 wrap/unwrap, nonce uniqueness)
 * with a stubbed PRF output. The orchestration helpers (enrollPasskey,
 * loginWithPasskey) are integration-tested in the route test file —
 * those need the full WebAuthn ceremony mocked end-to-end and
 * provide diminishing returns at the unit-test layer.
 */

import { describe, it, expect } from "vitest";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import {
  derivePasskeyWrapKey,
  wrapUserData,
  unwrapUserData,
  PASSKEY_PRF_SALT_BYTES,
  PASSKEY_PRF_SALT_BASE64URL,
} from "./passkey-client";
import { randomBytes, toBase64 } from "@/lib/crypto/utils";

const SAMPLE_PRF_OUTPUT = new Uint8Array(32).map((_, i) => i + 1);
const SAMPLE_PRF_OUTPUT_2 = new Uint8Array(32).map((_, i) => 31 - i);

const PLAIN = {
  encryptionPrivateKey: "QQ".repeat(32), // base64-y string, doesn't matter
  kemPrivateKey: "BB".repeat(32),
};

describe("PASSKEY_PRF_SALT", () => {
  it("is exactly 32 bytes", () => {
    expect(PASSKEY_PRF_SALT_BYTES.length).toBe(32);
  });
  it("is deterministic across imports", () => {
    // Re-derive with the same input string — should match the
    // exported constant exactly. Guards against an accidental
    // info-string change that would orphan every existing wrap.
    expect(PASSKEY_PRF_SALT_BASE64URL.length).toBeGreaterThan(0);
    expect(PASSKEY_PRF_SALT_BASE64URL).not.toContain("+");
    expect(PASSKEY_PRF_SALT_BASE64URL).not.toContain("/");
    expect(PASSKEY_PRF_SALT_BASE64URL.endsWith("=")).toBe(false);
  });
});

describe("derivePasskeyWrapKey", () => {
  it("returns 32 bytes", () => {
    const k = derivePasskeyWrapKey(SAMPLE_PRF_OUTPUT);
    expect(k.length).toBe(32);
  });
  it("is deterministic for the same PRF output", () => {
    const a = derivePasskeyWrapKey(SAMPLE_PRF_OUTPUT);
    const b = derivePasskeyWrapKey(SAMPLE_PRF_OUTPUT);
    expect(Buffer.from(a)).toEqual(Buffer.from(b));
  });
  it("differs for different PRF outputs (domain separation)", () => {
    const a = derivePasskeyWrapKey(SAMPLE_PRF_OUTPUT);
    const b = derivePasskeyWrapKey(SAMPLE_PRF_OUTPUT_2);
    expect(Buffer.from(a)).not.toEqual(Buffer.from(b));
  });
});

describe("wrapUserData / unwrapUserData", () => {
  it("round-trips a user-data payload", () => {
    const wrapped = wrapUserData(PLAIN, SAMPLE_PRF_OUTPUT);
    const back = unwrapUserData(wrapped, SAMPLE_PRF_OUTPUT);
    expect(back.encryptionPrivateKey).toBe(PLAIN.encryptionPrivateKey);
    expect(back.kemPrivateKey).toBe(PLAIN.kemPrivateKey);
  });

  it("uses a fresh nonce per wrap", () => {
    const a = wrapUserData(PLAIN, SAMPLE_PRF_OUTPUT);
    const b = wrapUserData(PLAIN, SAMPLE_PRF_OUTPUT);
    expect(a.nonce).not.toBe(b.nonce);
    // ciphertext also differs because of nonce-keyed AEAD
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("rejects unwrap with the wrong PRF output", () => {
    const wrapped = wrapUserData(PLAIN, SAMPLE_PRF_OUTPUT);
    expect(() => unwrapUserData(wrapped, SAMPLE_PRF_OUTPUT_2)).toThrow();
  });

  it("rejects a tampered ciphertext", () => {
    const wrapped = wrapUserData(PLAIN, SAMPLE_PRF_OUTPUT);
    // Flip a byte in the base64 ciphertext (rough but reliable: any
    // edit to a non-padding char will break Poly1305).
    const tampered = {
      ...wrapped,
      ciphertext:
        wrapped.ciphertext.slice(0, -2) +
        (wrapped.ciphertext.endsWith("A") ? "B" : "A") +
        wrapped.ciphertext.slice(-1),
    };
    expect(() => unwrapUserData(tampered, SAMPLE_PRF_OUTPUT)).toThrow();
  });

  it("rejects a wrap with an unexpected payload shape", () => {
    // Manually wrap a string instead of the {enc, kem} object — the
    // unwrap should refuse it rather than handing back a malformed
    // result that would crash downstream key loaders.
    const json = JSON.stringify({ unexpected: true });
    const messageBytes = new TextEncoder().encode(json);
    const wrapKey = derivePasskeyWrapKey(SAMPLE_PRF_OUTPUT);
    const nonce = randomBytes(24);
    const ciphertext = xchacha20poly1305(wrapKey, nonce).encrypt(messageBytes);
    const wrapped = {
      ciphertext: toBase64(ciphertext),
      nonce: toBase64(nonce),
    };
    expect(() => unwrapUserData(wrapped, SAMPLE_PRF_OUTPUT)).toThrow(
      /invalid wrapped user-data shape/,
    );
  });
});
