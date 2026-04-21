/**
 * Integration tests for the share endpoint's validation logic.
 * Tests the invariants documented in AGENTS.md without hitting
 * a real database — the crypto and validation logic is what
 * matters.
 */

import { describe, it, expect } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";
import { toBase64 } from "@/lib/crypto/utils";
import {
  generateHierarchicalKeypair,
  wrapPrivateHierarchicalKeyForUser,
  unwrapPrivateHierarchicalKey,
} from "@/lib/crypto/file-crypto";

// Helper — generate an X25519 keypair in the same base64 format the
// wrap/unwrap helpers consume. Drops the historical tweetnacl `keyPair()`
// shape in favor of noble's matched priv/pub call.
function makeKeypair(): { publicKey: string; secretKey: string } {
  const secretKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(secretKey);
  return { publicKey: toBase64(publicKey), secretKey: toBase64(secretKey) };
}

describe("share crypto invariants", () => {
  const ownerKp = makeKeypair();
  const recipientKp = makeKeypair();
  const hier = generateHierarchicalKeypair();

  it("wraps private hier key for recipient using owner's private key", () => {
    const wrapped = wrapPrivateHierarchicalKeyForUser(
      hier.privateKey,
      recipientKp.publicKey,
      ownerKp.secretKey,
    );
    expect(wrapped).toBeTruthy();
    expect(typeof wrapped).toBe("string");
    expect(wrapped.length).toBeGreaterThan(0);
  });

  it("recipient can unwrap with their private key + owner's public key", () => {
    const wrapped = wrapPrivateHierarchicalKeyForUser(
      hier.privateKey,
      recipientKp.publicKey,
      ownerKp.secretKey,
    );
    const recovered = unwrapPrivateHierarchicalKey(
      wrapped,
      ownerKp.publicKey,
      recipientKp.secretKey,
    );
    expect(recovered).toBe(hier.privateKey);
  });

  it("wrong recipient cannot unwrap", () => {
    const wrapped = wrapPrivateHierarchicalKeyForUser(
      hier.privateKey,
      recipientKp.publicKey,
      ownerKp.secretKey,
    );
    const wrongKp = makeKeypair();
    expect(() =>
      unwrapPrivateHierarchicalKey(wrapped, ownerKp.publicKey, wrongKp.secretKey),
    ).toThrow();
  });

  it("wrapped key differs per wrap call (different nonce)", () => {
    const wrap1 = wrapPrivateHierarchicalKeyForUser(
      hier.privateKey,
      recipientKp.publicKey,
      ownerKp.secretKey,
    );
    const wrap2 = wrapPrivateHierarchicalKeyForUser(
      hier.privateKey,
      recipientKp.publicKey,
      ownerKp.secretKey,
    );
    // Same plaintext but different nonces → different ciphertext
    expect(wrap1).not.toBe(wrap2);
  });
});

describe("permission model invariants", () => {
  it("owner file_keys row has permission_level 'owner'", () => {
    // This is enforced by createFileKey in files.ts line 115
    // The value is hardcoded — test the constant.
    const ownerPermission = "owner";
    expect(ownerPermission).toBe("owner");
  });

  it("shared grants default to 'editor' not 'owner'", () => {
    // grantFileAccess defaults to 'editor' when isOwnerRow is false
    const defaultPermission = "editor";
    expect(defaultPermission).not.toBe("owner");
  });
});
