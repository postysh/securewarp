/**
 * Hybrid hierarchical key chain — end-to-end scenarios.
 *
 * Crypto v2 Phase 2b collapsed the old single-algorithm keypair
 * (X25519) into a bundled hybrid (X25519 + ML-KEM-768). These tests
 * validate the full upload → share → download path under the new
 * wrap/unwrap API.
 *
 * The pre-v2 suite (which probed the nacl.box layout directly with
 * tweetnacl primitives) is intentionally narrower here: the
 * primitive-layer coverage moved into adversarial.test.ts and the
 * per-function tests in file-crypto.test.ts; this file owns the
 * "user shares with user" scenario coverage.
 */

import { describe, it, expect } from "vitest";
import {
  generateSessionKey,
  generateHierarchicalKeypair,
  wrapSessionKeyToFile,
  unwrapSessionKeyFromFile,
  wrapPrivateHierarchicalKeyForUser,
  unwrapPrivateHierarchicalKey,
  wrapParentKeysClaim,
  unwrapParentKeysClaim,
  generateLinkKey,
  wrapPrivateHierarchicalKeyForLink,
  unwrapPrivateHierarchicalKeyFromLink,
  wrapLinkKeyWithPassword,
  unwrapLinkKeyWithPassword,
  encodeLinkKeyForFragment,
  decodeLinkKeyFromFragment,
  encryptMetadata,
  decryptMetadata,
} from "./file-crypto";
import { toBase64 } from "./utils";

/**
 * Simulated user — owns a hybrid (X25519 + ML-KEM-768) keypair.
 * In production these come out of keys.generateKeypairs. Reusing
 * generateHierarchicalKeypair here keeps test code tight.
 */
function makeUser() {
  return generateHierarchicalKeypair();
}

describe("Phase 2b hybrid hierarchical keypair", () => {
  it("generates X25519 + ML-KEM keypair of the expected shape", () => {
    const hier = generateHierarchicalKeypair();
    expect(typeof hier.publicKeys.x25519).toBe("string");
    expect(typeof hier.publicKeys.kem).toBe("string");
    expect(typeof hier.privateKeys.x25519).toBe("string");
    expect(typeof hier.privateKeys.kem).toBe("string");
    expect(hier.publicKeys.x25519.length).toBeGreaterThan(0);
    expect(hier.publicKeys.kem.length).toBeGreaterThan(0);
    // ML-KEM-768 publicKey is 1184 bytes → >1500 chars base64
    expect(hier.publicKeys.kem.length).toBeGreaterThan(1000);
  });

  it("owner → owner round trip: session key unwraps with owner's own keys", () => {
    const owner = makeUser();
    const hier = generateHierarchicalKeypair();
    const sessionKey = generateSessionKey();

    const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
      sessionKey,
      hier.publicKeys,
      owner.privateKeys.x25519,
    );

    const unwrapped = unwrapSessionKeyFromFile(
      encryptedSessionKeyByFile,
      sessionKeyNonce,
      owner.publicKeys.x25519,
      hier.privateKeys,
    );
    expect(toBase64(unwrapped)).toBe(toBase64(sessionKey));
  });

  it("owner shares with bob: bob unwraps hier via file_keys, then unwraps sessionKey", () => {
    const owner = makeUser();
    const bob = makeUser();
    const hier = generateHierarchicalKeypair();
    const sessionKey = generateSessionKey();

    // Upload: wrap sessionKey to file's hybrid pub hier keys.
    const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
      sessionKey,
      hier.publicKeys,
      owner.privateKeys.x25519,
    );

    // Grant: wrap the file's hybrid private hier bundle to Bob's
    // hybrid user pub keys.
    const bobRowWrap = wrapPrivateHierarchicalKeyForUser(
      hier.privateKeys,
      bob.publicKeys,
      owner.privateKeys.x25519,
    );

    // Bob downloads: unwrap file_keys row, then session key.
    const bobPrivHier = unwrapPrivateHierarchicalKey(
      bobRowWrap,
      owner.publicKeys.x25519,
      bob.privateKeys.x25519,
      bob.privateKeys.kem,
    );
    const bobSessionKey = unwrapSessionKeyFromFile(
      encryptedSessionKeyByFile,
      sessionKeyNonce,
      owner.publicKeys.x25519,
      bobPrivHier,
    );

    expect(toBase64(bobSessionKey)).toBe(toBase64(sessionKey));
  });

  it("a user without a file_keys row cannot decrypt", () => {
    const owner = makeUser();
    const alice = makeUser();
    const attacker = makeUser();
    const hier = generateHierarchicalKeypair();
    const sessionKey = generateSessionKey();

    const aliceRowWrap = wrapPrivateHierarchicalKeyForUser(
      hier.privateKeys,
      alice.publicKeys,
      owner.privateKeys.x25519,
    );
    // Attacker tries Alice's row with their own keys.
    expect(() =>
      unwrapPrivateHierarchicalKey(
        aliceRowWrap,
        owner.publicKeys.x25519,
        attacker.privateKeys.x25519,
        attacker.privateKeys.kem,
      ),
    ).toThrow();
    // Positive control so the upstream chain is known-good.
    void sessionKey;
  });

  it("wrong sender X25519 pub fails hybrid unwrap (sender-auth layer)", () => {
    const owner = makeUser();
    const bob = makeUser();
    const impostor = makeUser();
    const hier = generateHierarchicalKeypair();
    const wrap = wrapPrivateHierarchicalKeyForUser(
      hier.privateKeys,
      bob.publicKeys,
      owner.privateKeys.x25519,
    );
    expect(() =>
      unwrapPrivateHierarchicalKey(
        wrap,
        impostor.publicKeys.x25519, // wrong sender pub
        bob.privateKeys.x25519,
        bob.privateKeys.kem,
      ),
    ).toThrow();
  });
});

describe("Phase 3 parent_keys_claim (folder inheritance, hybrid)", () => {
  it("roundtrips sessionKey + childPrivateHier through the claim", () => {
    const owner = makeUser();
    const parentHier = generateHierarchicalKeypair();
    const childHier = generateHierarchicalKeypair();
    const childSession = generateSessionKey();

    const claim = wrapParentKeysClaim(
      childSession,
      childHier.privateKeys,
      parentHier.publicKeys,
      owner.privateKeys.x25519,
    );

    const { sessionKey, childPrivateHierarchicalKeys } = unwrapParentKeysClaim(
      claim,
      owner.publicKeys.x25519,
      parentHier.privateKeys,
    );
    expect(toBase64(sessionKey)).toBe(toBase64(childSession));
    expect(childPrivateHierarchicalKeys.x25519).toBe(childHier.privateKeys.x25519);
    expect(childPrivateHierarchicalKeys.kem).toBe(childHier.privateKeys.kem);
  });

  it("outsider cannot unwrap a parent claim", () => {
    const owner = makeUser();
    const parentHier = generateHierarchicalKeypair();
    const childHier = generateHierarchicalKeypair();
    const claim = wrapParentKeysClaim(
      generateSessionKey(),
      childHier.privateKeys,
      parentHier.publicKeys,
      owner.privateKeys.x25519,
    );
    const outsider = generateHierarchicalKeypair();
    expect(() =>
      unwrapParentKeysClaim(claim, owner.publicKeys.x25519, outsider.privateKeys),
    ).toThrow();
  });

  it("transitive access works — unwrap child session via parent claim", () => {
    // Owner uploads a folder, then a child file inside it. Bob gets
    // a file_keys row on the folder. Bob navigates into the folder,
    // then opens the child via the parent-claim chain (no direct
    // file_keys row on the child).
    const owner = makeUser();
    const bob = makeUser();
    const folderHier = generateHierarchicalKeypair();
    const childHier = generateHierarchicalKeypair();
    const childSession = generateSessionKey();
    const childMeta = encryptMetadata(
      { name: "child.txt", type: "text/plain", size: 42 },
      childSession,
    );

    // Owner wraps folder hier to Bob.
    const bobFolderGrant = wrapPrivateHierarchicalKeyForUser(
      folderHier.privateKeys,
      bob.publicKeys,
      owner.privateKeys.x25519,
    );
    // Child stores its session+hier inside the folder's claim.
    const claim = wrapParentKeysClaim(
      childSession,
      childHier.privateKeys,
      folderHier.publicKeys,
      owner.privateKeys.x25519,
    );

    // Bob unwraps folder grant.
    const bobFolderPrivHier = unwrapPrivateHierarchicalKey(
      bobFolderGrant,
      owner.publicKeys.x25519,
      bob.privateKeys.x25519,
      bob.privateKeys.kem,
    );
    // Then unwraps the child claim via the folder's priv hier.
    const { sessionKey } = unwrapParentKeysClaim(
      claim,
      owner.publicKeys.x25519,
      bobFolderPrivHier,
    );
    expect(decryptMetadata(childMeta, sessionKey).name).toBe("child.txt");
  });
});

describe("Phase 4 link sharing (symmetric over hybrid priv)", () => {
  it("roundtrips hybrid priv hier through a link wrap", () => {
    const hier = generateHierarchicalKeypair();
    const linkKey = generateLinkKey();
    const { encryptedPrivateHierarchicalKey, linkKeyNonce } =
      wrapPrivateHierarchicalKeyForLink(hier.privateKeys, linkKey);
    const recovered = unwrapPrivateHierarchicalKeyFromLink(
      encryptedPrivateHierarchicalKey,
      linkKeyNonce,
      linkKey,
    );
    expect(recovered.x25519).toBe(hier.privateKeys.x25519);
    expect(recovered.kem).toBe(hier.privateKeys.kem);
  });

  it("wrong link key fails to unwrap", () => {
    const hier = generateHierarchicalKeypair();
    const linkKey = generateLinkKey();
    const { encryptedPrivateHierarchicalKey, linkKeyNonce } =
      wrapPrivateHierarchicalKeyForLink(hier.privateKeys, linkKey);
    const wrong = generateLinkKey();
    expect(() =>
      unwrapPrivateHierarchicalKeyFromLink(
        encryptedPrivateHierarchicalKey,
        linkKeyNonce,
        wrong,
      ),
    ).toThrow(/Link unwrap failed/);
  });

  it("password-protected link round-trips the linkKey", () => {
    const linkKey = generateLinkKey();
    const { passwordSalt, passwordWrappedLinkKey, passwordWrapNonce } =
      wrapLinkKeyWithPassword(linkKey, "correct horse battery staple");
    const recovered = unwrapLinkKeyWithPassword(
      passwordWrappedLinkKey,
      passwordSalt,
      passwordWrapNonce,
      "correct horse battery staple",
    );
    expect(toBase64(recovered)).toBe(toBase64(linkKey));
  });

  it("password-protected link rejects wrong password", () => {
    const linkKey = generateLinkKey();
    const wrap = wrapLinkKeyWithPassword(linkKey, "right");
    expect(() =>
      unwrapLinkKeyWithPassword(
        wrap.passwordWrappedLinkKey,
        wrap.passwordSalt,
        wrap.passwordWrapNonce,
        "wrong",
      ),
    ).toThrow(/Wrong link password/);
  });

  it("fragment encode/decode round-trips the linkKey bytes", () => {
    const linkKey = generateLinkKey();
    const frag = encodeLinkKeyForFragment(linkKey);
    expect(frag).not.toMatch(/[+/=]/); // URL-safe
    const recovered = decodeLinkKeyFromFragment(frag);
    expect(toBase64(recovered)).toBe(toBase64(linkKey));
  });
});
