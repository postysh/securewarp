/**
 * Tests for the file encryption pipeline — session key wrap/unwrap,
 * metadata encrypt/decrypt, and the hierarchical key chain.
 */

import { describe, it, expect } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";
import { toBase64 } from "./utils";

function makeKp() {
  const secretKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(secretKey);
  return { secretKey, publicKey };
}
import {
  generateSessionKey,
  encryptMetadata,
  decryptMetadata,
  generateHierarchicalKeypair,
  wrapSessionKeyToFile,
  unwrapSessionKeyFromFile,
  wrapPrivateHierarchicalKeyForUser,
  unwrapPrivateHierarchicalKey,
  wrapParentKeysClaim,
  unwrapParentKeysClaim,
} from "./file-crypto";

describe("session key wrap/unwrap", () => {
  const ownerKp = makeKp();
  const hier = generateHierarchicalKeypair();
  const sessionKey = generateSessionKey();

  it("round-trips session key through file wrap", () => {
    const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
      sessionKey,
      hier.publicKey,
      toBase64(ownerKp.secretKey)
    );
    const unwrapped = unwrapSessionKeyFromFile(
      encryptedSessionKeyByFile,
      sessionKeyNonce,
      toBase64(ownerKp.publicKey),
      hier.privateKey
    );
    expect(toBase64(unwrapped)).toBe(toBase64(sessionKey));
  });

  it("wrong hier key fails to unwrap", () => {
    const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
      sessionKey,
      hier.publicKey,
      toBase64(ownerKp.secretKey)
    );
    const wrongHier = generateHierarchicalKeypair();
    expect(() =>
      unwrapSessionKeyFromFile(
        encryptedSessionKeyByFile,
        sessionKeyNonce,
        toBase64(ownerKp.publicKey),
        wrongHier.privateKey
      )
    ).toThrow();
  });
});

describe("metadata encrypt/decrypt", () => {
  const sessionKey = generateSessionKey();
  const meta = { name: "test.pdf", type: "application/pdf", size: 12345 };

  it("round-trips metadata", () => {
    const encrypted = encryptMetadata(meta, sessionKey);
    const decrypted = decryptMetadata(encrypted, sessionKey);
    expect(decrypted).toEqual(meta);
  });

  it("wrong key fails", () => {
    const encrypted = encryptMetadata(meta, sessionKey);
    const wrongKey = generateSessionKey();
    expect(() => decryptMetadata(encrypted, wrongKey)).toThrow();
  });
});

describe("hierarchical key chain", () => {
  const ownerKp = makeKp();
  const recipientKp = makeKp();
  const hier = generateHierarchicalKeypair();

  it("round-trips private hier key through user wrap", () => {
    const wrapped = wrapPrivateHierarchicalKeyForUser(
      hier.privateKey,
      toBase64(recipientKp.publicKey),
      toBase64(ownerKp.secretKey)
    );
    const unwrapped = unwrapPrivateHierarchicalKey(
      wrapped,
      toBase64(ownerKp.publicKey),
      toBase64(recipientKp.secretKey)
    );
    expect(unwrapped).toBe(hier.privateKey);
  });
});

describe("parent_keys_claim chain (Phase 3)", () => {
  const ownerKp = makeKp();
  const parentHier = generateHierarchicalKeypair();
  const childHier = generateHierarchicalKeypair();
  const childSessionKey = generateSessionKey();

  it("round-trips child session key + priv hier through parent claim", () => {
    const claim = wrapParentKeysClaim(
      childSessionKey,
      childHier.privateKey,
      parentHier.publicKey,
      toBase64(ownerKp.secretKey)
    );
    const unwrapped = unwrapParentKeysClaim(
      claim,
      toBase64(ownerKp.publicKey),
      parentHier.privateKey
    );
    expect(toBase64(unwrapped.sessionKey)).toBe(toBase64(childSessionKey));
    expect(unwrapped.childPrivateHierarchicalKey).toBe(childHier.privateKey);
  });

  it("wrong parent key fails", () => {
    const claim = wrapParentKeysClaim(
      childSessionKey,
      childHier.privateKey,
      parentHier.publicKey,
      toBase64(ownerKp.secretKey)
    );
    const wrongParent = generateHierarchicalKeypair();
    expect(() =>
      unwrapParentKeysClaim(claim, toBase64(ownerKp.publicKey), wrongParent.privateKey)
    ).toThrow();
  });
});
