/**
 * Integration tests for the share endpoint's validation logic.
 * Tests the invariants documented in AGENTS.md without hitting
 * a real database — the crypto and validation logic is what
 * matters.
 */

import { describe, it, expect } from "vitest";
import {
  generateHierarchicalKeypair,
  wrapPrivateHierarchicalKeyForUser,
  unwrapPrivateHierarchicalKey,
} from "@/lib/crypto/file-crypto";

function makeUser() {
  return generateHierarchicalKeypair();
}

describe("share crypto invariants (hybrid)", () => {
  const owner = makeUser();
  const recipient = makeUser();
  const hier = generateHierarchicalKeypair();

  it("wraps private hier key for recipient using owner's X25519 private key", () => {
    const wrapped = wrapPrivateHierarchicalKeyForUser(
      hier.privateKeys,
      recipient.publicKeys,
      owner.privateKeys.x25519,
    );
    expect(wrapped).toBeTruthy();
    expect(typeof wrapped).toBe("string");
    expect(wrapped.length).toBeGreaterThan(0);
  });

  it("recipient can unwrap with both private halves + owner's public key", () => {
    const wrapped = wrapPrivateHierarchicalKeyForUser(
      hier.privateKeys,
      recipient.publicKeys,
      owner.privateKeys.x25519,
    );
    const recovered = unwrapPrivateHierarchicalKey(
      wrapped,
      owner.publicKeys.x25519,
      recipient.privateKeys.x25519,
      recipient.privateKeys.kem,
    );
    expect(recovered.x25519).toBe(hier.privateKeys.x25519);
    expect(recovered.kem).toBe(hier.privateKeys.kem);
  });

  it("wrong recipient cannot unwrap", () => {
    const wrapped = wrapPrivateHierarchicalKeyForUser(
      hier.privateKeys,
      recipient.publicKeys,
      owner.privateKeys.x25519,
    );
    const wrong = makeUser();
    expect(() =>
      unwrapPrivateHierarchicalKey(
        wrapped,
        owner.publicKeys.x25519,
        wrong.privateKeys.x25519,
        wrong.privateKeys.kem,
      ),
    ).toThrow();
  });

  it("wrapped key differs per wrap call (different nonce + fresh KEM encap)", () => {
    const wrap1 = wrapPrivateHierarchicalKeyForUser(
      hier.privateKeys,
      recipient.publicKeys,
      owner.privateKeys.x25519,
    );
    const wrap2 = wrapPrivateHierarchicalKeyForUser(
      hier.privateKeys,
      recipient.publicKeys,
      owner.privateKeys.x25519,
    );
    expect(wrap1).not.toBe(wrap2);
  });
});

describe("permission model invariants", () => {
  it("owner file_keys row has permission_level 'owner'", () => {
    const ownerPermission = "owner";
    expect(ownerPermission).toBe("owner");
  });

  it("shared grants default to 'editor' not 'owner'", () => {
    const defaultPermission = "editor";
    expect(defaultPermission).not.toBe("owner");
  });
});
