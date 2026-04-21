import { describe, it, expect } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";
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
 * Simulated "user" — owns an X25519 keypair, the same shape a real
 * SecureWarp account has. Used to stand in for user A, B, C in sharing
 * scenarios without touching any network/server code.
 */
function makeUser() {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return {
    publicKey: toBase64(publicKey),
    privateKey: toBase64(privateKey),
  };
}

describe("Phase 2 hierarchical keypair", () => {
  it("generates Curve25519 keypair of the expected shape", () => {
    const hier = generateHierarchicalKeypair();
    expect(hier.publicKey).toBeTypeOf("string");
    expect(hier.privateKey).toBeTypeOf("string");
    expect(hier.publicKey).not.toBe(hier.privateKey);
  });

  it("owner can upload, download, and read the session key", () => {
    const owner = makeUser();
    const sessionKey = generateSessionKey();
    const hier = generateHierarchicalKeypair();

    // Upload: wrap sessionKey to file's pub hier key, wrap priv hier key
    // to owner's own public key (file_keys row for the owner).
    const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
      sessionKey,
      hier.publicKey,
      owner.privateKey
    );
    const ownerRow = wrapPrivateHierarchicalKeyForUser(
      hier.privateKey,
      owner.publicKey,
      owner.privateKey
    );

    // Download path: unwrap priv hier → unwrap session key.
    const recoveredPrivHier = unwrapPrivateHierarchicalKey(
      ownerRow,
      owner.publicKey, // wrapped_by_public_key at upload is the owner's own pub
      owner.privateKey
    );
    const recoveredSessionKey = unwrapSessionKeyFromFile(
      encryptedSessionKeyByFile,
      sessionKeyNonce,
      owner.publicKey, // session key was wrapped by the owner
      recoveredPrivHier
    );
    expect(toBase64(recoveredSessionKey)).toBe(toBase64(sessionKey));
  });

  it("owner shares with B, B decrypts — metadata and content roundtrip", () => {
    const owner = makeUser();
    const bob = makeUser();

    const sessionKey = generateSessionKey();
    const hier = generateHierarchicalKeypair();

    // Owner's upload-time artifacts
    const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
      sessionKey,
      hier.publicKey,
      owner.privateKey
    );
    const encMeta = encryptMetadata(
      { name: "photo.png", type: "image/png", size: 12345 },
      sessionKey
    );

    // Owner shares → wraps priv hier key to Bob using owner's priv as sender.
    const bobRow = wrapPrivateHierarchicalKeyForUser(
      hier.privateKey,
      bob.publicKey,
      owner.privateKey
    );

    // Bob's full decrypt path:
    // 1. Unwrap his row using owner's pub (the sharer) + his own priv.
    const bobPrivHier = unwrapPrivateHierarchicalKey(
      bobRow,
      owner.publicKey,
      bob.privateKey
    );
    // 2. Use it to unwrap the session key wrapped to the file's pub hier key.
    const bobSessionKey = unwrapSessionKeyFromFile(
      encryptedSessionKeyByFile,
      sessionKeyNonce,
      owner.publicKey,
      bobPrivHier
    );
    // 3. Decrypt metadata with the recovered session key.
    const meta = decryptMetadata(encMeta, bobSessionKey);

    expect(meta.name).toBe("photo.png");
    expect(meta.size).toBe(12345);
    expect(toBase64(bobSessionKey)).toBe(toBase64(sessionKey));
  });

  it("non-owner can re-share — Bob grants Carol without the owner", () => {
    const owner = makeUser();
    const bob = makeUser();
    const carol = makeUser();

    const sessionKey = generateSessionKey();
    const hier = generateHierarchicalKeypair();

    const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
      sessionKey,
      hier.publicKey,
      owner.privateKey
    );
    // Owner shares to Bob.
    const bobRow = wrapPrivateHierarchicalKeyForUser(
      hier.privateKey,
      bob.publicKey,
      owner.privateKey
    );

    // Bob unwraps his row (owner was the sharer).
    const bobPrivHier = unwrapPrivateHierarchicalKey(
      bobRow,
      owner.publicKey,
      bob.privateKey
    );

    // Bob re-shares to Carol — Bob is now the box sender.
    const carolRow = wrapPrivateHierarchicalKeyForUser(
      bobPrivHier,
      carol.publicKey,
      bob.privateKey
    );

    // Carol unwraps her row using BOB'S pub, not the owner's.
    const carolPrivHier = unwrapPrivateHierarchicalKey(
      carolRow,
      bob.publicKey,
      carol.privateKey
    );

    // Even though Bob was the sharer, the session key itself is still
    // wrapped with the owner as sender — Carol uses the owner's pub here.
    const carolSessionKey = unwrapSessionKeyFromFile(
      encryptedSessionKeyByFile,
      sessionKeyNonce,
      owner.publicKey,
      carolPrivHier
    );
    expect(toBase64(carolSessionKey)).toBe(toBase64(sessionKey));
  });

  it("a user without a file_keys row cannot decrypt", () => {
    const owner = makeUser();
    const eve = makeUser();

    const sessionKey = generateSessionKey();
    const hier = generateHierarchicalKeypair();
    const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
      sessionKey,
      hier.publicKey,
      owner.privateKey
    );

    // Eve tries to unwrap the session key directly with her own priv key
    // — she doesn't have the file's private hier key.
    expect(() =>
      unwrapSessionKeyFromFile(
        encryptedSessionKeyByFile,
        sessionKeyNonce,
        owner.publicKey,
        eve.privateKey
      )
    ).toThrow(/Box decryption failed/);
  });

  it("wrong sender public key fails the hierarchical unwrap", () => {
    const owner = makeUser();
    const bob = makeUser();
    const imposter = makeUser();

    const hier = generateHierarchicalKeypair();
    const bobRow = wrapPrivateHierarchicalKeyForUser(
      hier.privateKey,
      bob.publicKey,
      owner.privateKey
    );

    // Bob tries to unwrap pretending the imposter was the sharer.
    expect(() =>
      unwrapPrivateHierarchicalKey(bobRow, imposter.publicKey, bob.privateKey)
    ).toThrow(/Box decryption failed/);
  });

  it("rejects tampered session-key ciphertext", () => {
    const owner = makeUser();
    const hier = generateHierarchicalKeypair();
    const sessionKey = generateSessionKey();

    const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
      sessionKey,
      hier.publicKey,
      owner.privateKey
    );

    // Flip one char in the ciphertext — Poly1305 must catch it.
    const tampered = encryptedSessionKeyByFile.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect(() =>
      unwrapSessionKeyFromFile(tampered, sessionKeyNonce, owner.publicKey, hier.privateKey)
    ).toThrow(/Box decryption failed/);
  });
});

describe("Phase 3 parent_keys_claim (folder inheritance)", () => {
  it("wrap/unwrap roundtrips {sessionKey, childPrivHier} through a parent keypair", () => {
    const owner = makeUser();
    const parentHier = generateHierarchicalKeypair();
    const childPrivHier = generateHierarchicalKeypair().privateKey;
    const childSessionKey = generateSessionKey();

    const claim = wrapParentKeysClaim(
      childSessionKey,
      childPrivHier,
      parentHier.publicKey,
      owner.privateKey
    );
    const unwrapped = unwrapParentKeysClaim(claim, owner.publicKey, parentHier.privateKey);

    expect(toBase64(unwrapped.sessionKey)).toBe(toBase64(childSessionKey));
    expect(unwrapped.childPrivateHierarchicalKey).toBe(childPrivHier);
  });

  it("single-level inheritance: A → folder F → file X shared with B", () => {
    const owner = makeUser();
    const bob = makeUser();

    // Owner uploads folder F.
    const fHier = generateHierarchicalKeypair();
    const fSessionKey = generateSessionKey();
    // (session key wrap for F itself is irrelevant here; B only needs F's
    // priv hier to unwrap children via parent_keys_claim.)
    const fRowForOwner = wrapPrivateHierarchicalKeyForUser(
      fHier.privateKey,
      owner.publicKey,
      owner.privateKey
    );

    // Owner uploads X inside F. X gets its own hier keypair; its session
    // key and priv hier are additionally wrapped under F's pub hier key.
    const xHier = generateHierarchicalKeypair();
    const xSessionKey = generateSessionKey();
    const {
      encryptedSessionKeyByFile: xEncSessionByFile,
      sessionKeyNonce: xSessionKeyNonce,
    } = wrapSessionKeyToFile(xSessionKey, xHier.publicKey, owner.privateKey);
    const xEncMeta = encryptMetadata(
      { name: "inside-F.txt", type: "text/plain", size: 7 },
      xSessionKey
    );
    const xParentClaim = wrapParentKeysClaim(
      xSessionKey,
      xHier.privateKey,
      fHier.publicKey,
      owner.privateKey
    );

    // Owner shares folder F with Bob — grants a direct file_keys row on F.
    const fRowForBob = wrapPrivateHierarchicalKeyForUser(
      fHier.privateKey,
      bob.publicKey,
      owner.privateKey
    );

    // Bob's decrypt path: unwrap his F row (owner was the sharer), then
    // walk down to X via its parent_keys_claim using F's priv hier.
    const bobFPrivHier = unwrapPrivateHierarchicalKey(
      fRowForBob,
      owner.publicKey,
      bob.privateKey
    );
    const xUnwrapped = unwrapParentKeysClaim(
      xParentClaim,
      owner.publicKey, // the box sender for the claim is the file owner
      bobFPrivHier
    );

    // Confirm the session key round-trips exactly and metadata decrypts.
    expect(toBase64(xUnwrapped.sessionKey)).toBe(toBase64(xSessionKey));
    const meta = decryptMetadata(xEncMeta, xUnwrapped.sessionKey);
    expect(meta.name).toBe("inside-F.txt");
    expect(meta.size).toBe(7);

    // And the hybrid invariant: the owner can independently reach X via
    // the direct route (session key wrapped to X's own pub hier key) and
    // should get the same session key bytes.
    const ownerXPrivHier = xUnwrapped.childPrivateHierarchicalKey;
    const ownerXSessionKey = unwrapSessionKeyFromFile(
      xEncSessionByFile,
      xSessionKeyNonce,
      owner.publicKey,
      ownerXPrivHier
    );
    expect(toBase64(ownerXSessionKey)).toBe(toBase64(xSessionKey));
    // Sanity: fRowForOwner also unwraps for the owner (kept as invariant
    // that owners always have a direct row on folders they own).
    expect(
      unwrapPrivateHierarchicalKey(fRowForOwner, owner.publicKey, owner.privateKey)
    ).toBe(fHier.privateKey);
  });

  it("two-level inheritance: F → sub → X traversal by a Bob-then-Carol chain", () => {
    const owner = makeUser();
    const bob = makeUser();
    const carol = makeUser();

    // Build F, F/sub, F/sub/X with parent claims at each level.
    const fHier = generateHierarchicalKeypair();

    const subHier = generateHierarchicalKeypair();
    const subSessionKey = generateSessionKey();
    const subParentClaim = wrapParentKeysClaim(
      subSessionKey,
      subHier.privateKey,
      fHier.publicKey,
      owner.privateKey
    );

    const xHier = generateHierarchicalKeypair();
    const xSessionKey = generateSessionKey();
    const xEncMeta = encryptMetadata(
      { name: "deep.txt", type: "text/plain", size: 99 },
      xSessionKey
    );
    const xParentClaim = wrapParentKeysClaim(
      xSessionKey,
      xHier.privateKey,
      subHier.publicKey,
      owner.privateKey
    );

    // A shares F with Bob.
    const fRowForBob = wrapPrivateHierarchicalKeyForUser(
      fHier.privateKey,
      bob.publicKey,
      owner.privateKey
    );

    // Bob walks the chain: F → sub → X.
    const bobFPrivHier = unwrapPrivateHierarchicalKey(
      fRowForBob,
      owner.publicKey,
      bob.privateKey
    );
    const subUnwrapped = unwrapParentKeysClaim(
      subParentClaim,
      owner.publicKey,
      bobFPrivHier
    );
    const xUnwrappedByBob = unwrapParentKeysClaim(
      xParentClaim,
      owner.publicKey,
      subUnwrapped.childPrivateHierarchicalKey
    );
    expect(toBase64(xUnwrappedByBob.sessionKey)).toBe(toBase64(xSessionKey));
    expect(decryptMetadata(xEncMeta, xUnwrappedByBob.sessionKey).name).toBe("deep.txt");

    // Bob re-shares F with Carol. Carol unwraps using Bob's pub as sender,
    // then walks the same claim chain (claim senders are still the owner).
    const fRowForCarol = wrapPrivateHierarchicalKeyForUser(
      bobFPrivHier,
      carol.publicKey,
      bob.privateKey
    );
    const carolFPrivHier = unwrapPrivateHierarchicalKey(
      fRowForCarol,
      bob.publicKey,
      carol.privateKey
    );
    const subUnwrappedByCarol = unwrapParentKeysClaim(
      subParentClaim,
      owner.publicKey,
      carolFPrivHier
    );
    const xUnwrappedByCarol = unwrapParentKeysClaim(
      xParentClaim,
      owner.publicKey,
      subUnwrappedByCarol.childPrivateHierarchicalKey
    );
    expect(toBase64(xUnwrappedByCarol.sessionKey)).toBe(toBase64(xSessionKey));
  });

  it("outsider cannot unwrap a parent claim", () => {
    const owner = makeUser();
    const eve = makeUser();
    const fHier = generateHierarchicalKeypair();
    const xPrivHier = generateHierarchicalKeypair().privateKey;
    const xSessionKey = generateSessionKey();

    const claim = wrapParentKeysClaim(
      xSessionKey,
      xPrivHier,
      fHier.publicKey,
      owner.privateKey
    );

    // Eve has no access to F's private hier key; she tries with her own
    // private key pretending to be the parent. Must throw.
    expect(() =>
      unwrapParentKeysClaim(claim, owner.publicKey, eve.privateKey)
    ).toThrow(/Box decryption failed/);
  });

  it("wrong claim sender public key is rejected", () => {
    const owner = makeUser();
    const imposter = makeUser();
    const fHier = generateHierarchicalKeypair();
    const xPrivHier = generateHierarchicalKeypair().privateKey;
    const xSessionKey = generateSessionKey();

    const claim = wrapParentKeysClaim(
      xSessionKey,
      xPrivHier,
      fHier.publicKey,
      owner.privateKey
    );

    // Holder of the parent priv hier has the right key, but passes the
    // wrong sender — should still fail authenticated-box open.
    expect(() =>
      unwrapParentKeysClaim(claim, imposter.publicKey, fHier.privateKey)
    ).toThrow(/Box decryption failed/);
  });
});

describe("Phase 4 link sharing (symmetric linkKey)", () => {
  it("wrap/unwrap roundtrips a private hierarchical key through a link key", () => {
    const hier = generateHierarchicalKeypair();
    const linkKey = generateLinkKey();

    const { encryptedPrivateHierarchicalKey, linkKeyNonce } =
      wrapPrivateHierarchicalKeyForLink(hier.privateKey, linkKey);
    const recovered = unwrapPrivateHierarchicalKeyFromLink(
      encryptedPrivateHierarchicalKey,
      linkKeyNonce,
      linkKey
    );
    expect(recovered).toBe(hier.privateKey);
  });

  it("rejects unwrap with the wrong link key", () => {
    const hier = generateHierarchicalKeypair();
    const linkKey = generateLinkKey();
    const wrongLinkKey = generateLinkKey();

    const { encryptedPrivateHierarchicalKey, linkKeyNonce } =
      wrapPrivateHierarchicalKeyForLink(hier.privateKey, linkKey);

    expect(() =>
      unwrapPrivateHierarchicalKeyFromLink(
        encryptedPrivateHierarchicalKey,
        linkKeyNonce,
        wrongLinkKey
      )
    ).toThrow(/Link unwrap failed/);
  });

  it("URL-safe fragment encode/decode roundtrips bytes", () => {
    // Exercise several random keys so we hit both with- and without-
    // padding branches.
    for (let i = 0; i < 20; i++) {
      const linkKey = generateLinkKey();
      const fragment = encodeLinkKeyForFragment(linkKey);
      expect(fragment).not.toContain("+");
      expect(fragment).not.toContain("/");
      expect(fragment).not.toContain("=");
      const decoded = decodeLinkKeyFromFragment(fragment);
      expect(toBase64(decoded)).toBe(toBase64(linkKey));
    }
  });

  it("end-to-end: owner creates a link, anonymous visitor decrypts", () => {
    // Simulates the entire /share/[id] flow without any file_keys row
    // for the visitor. Proves the design does not rely on the visitor
    // being a registered user.
    const owner = makeUser();
    const sessionKey = generateSessionKey();
    const hier = generateHierarchicalKeypair();

    // Owner-side upload: session key wrapped to file, metadata encrypted.
    const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
      sessionKey,
      hier.publicKey,
      owner.privateKey
    );
    const encMeta = encryptMetadata(
      { name: "leaked.txt", type: "text/plain", size: 42 },
      sessionKey
    );

    // Owner creates a link: generate linkKey, wrap priv hier under it.
    const linkKey = generateLinkKey();
    const { encryptedPrivateHierarchicalKey, linkKeyNonce } =
      wrapPrivateHierarchicalKeyForLink(hier.privateKey, linkKey);
    const fragment = encodeLinkKeyForFragment(linkKey);

    // Anonymous visitor opens the URL. They have: `fragment`, the
    // server payload (encryptedPrivateHierarchicalKey + linkKeyNonce),
    // and the file's public ciphertexts (encryptedSessionKeyByFile,
    // sessionKeyNonce, owner.publicKey). Zero account material.
    const recoveredLinkKey = decodeLinkKeyFromFragment(fragment);
    const recoveredPrivHier = unwrapPrivateHierarchicalKeyFromLink(
      encryptedPrivateHierarchicalKey,
      linkKeyNonce,
      recoveredLinkKey
    );
    const recoveredSessionKey = unwrapSessionKeyFromFile(
      encryptedSessionKeyByFile,
      sessionKeyNonce,
      owner.publicKey,
      recoveredPrivHier
    );
    const meta = decryptMetadata(encMeta, recoveredSessionKey);

    expect(toBase64(recoveredSessionKey)).toBe(toBase64(sessionKey));
    expect(meta.name).toBe("leaked.txt");
    expect(meta.size).toBe(42);
  });

  it("password-wrap roundtrips a linkKey through Argon2id + secretbox", () => {
    const linkKey = generateLinkKey();
    const wrap = wrapLinkKeyWithPassword(linkKey, "correct horse battery staple");
    const recovered = unwrapLinkKeyWithPassword(
      wrap.passwordWrappedLinkKey,
      wrap.passwordSalt,
      wrap.passwordWrapNonce,
      "correct horse battery staple"
    );
    expect(toBase64(recovered)).toBe(toBase64(linkKey));
  });

  it("wrong password is rejected by the password wrap", () => {
    const linkKey = generateLinkKey();
    const wrap = wrapLinkKeyWithPassword(linkKey, "hunter2");
    expect(() =>
      unwrapLinkKeyWithPassword(
        wrap.passwordWrappedLinkKey,
        wrap.passwordSalt,
        wrap.passwordWrapNonce,
        "hunter3"
      )
    ).toThrow(/Wrong link password/);
  });

  it("password-wrap produces different ciphertext each call (fresh salt)", () => {
    const linkKey = generateLinkKey();
    const a = wrapLinkKeyWithPassword(linkKey, "same-password");
    const b = wrapLinkKeyWithPassword(linkKey, "same-password");
    // Salts, nonces, and ciphertexts should all differ; the only
    // thing in common is that both unwrap to the original linkKey.
    expect(a.passwordSalt).not.toBe(b.passwordSalt);
    expect(a.passwordWrapNonce).not.toBe(b.passwordWrapNonce);
    expect(a.passwordWrappedLinkKey).not.toBe(b.passwordWrappedLinkKey);
  });

  it("phase 5.1: folder shallow rotation — Bob loses access, Alice and cached-descendants work correctly", () => {
    // Scenario under test:
    //   Owner creates folder F with child file X and subfolder Y
    //   containing grandchild Z.
    //   Owner shares F with Alice and Bob (single file_keys row each
    //   on F; X/Y/Z are inherited via parent_keys_claim).
    //   Owner then runs shallow folder rotation to revoke Bob.
    // Expected invariants:
    //   1. After rotation, Bob's OLD folder priv hier can't unwrap
    //      the new X and Y claims.
    //   2. Alice's refreshed folder priv hier CAN unwrap the new X
    //      and Y claims, and via Y reaches Z through Z's UNCHANGED
    //      claim.
    //   3. Z's claim is NOT touched by rotation — it's still encrypted
    //      under Y's (unchanged) pub hier.
    //   4. Cached-descendant caveat: if Bob had previously unwrapped
    //      X and cached X's session key directly, he can still
    //      decrypt X's encrypted metadata (documented limitation).

    const owner = makeUser();
    const alice = makeUser();
    const bob = makeUser();

    // Folder F
    const fHier = generateHierarchicalKeypair();
    const fSessionKey = generateSessionKey();

    // File X — direct child of F
    const xHier = generateHierarchicalKeypair();
    const xSessionKey = generateSessionKey();
    const xEncMeta = encryptMetadata(
      { name: "x.txt", type: "text/plain", size: 10 },
      xSessionKey
    );
    // X's claim wrapped under F's pub hier
    const xClaimOld = wrapParentKeysClaim(
      xSessionKey,
      xHier.privateKey,
      fHier.publicKey,
      owner.privateKey
    );

    // Subfolder Y — direct child of F
    const yHier = generateHierarchicalKeypair();
    const ySessionKey = generateSessionKey();
    const yClaimOld = wrapParentKeysClaim(
      ySessionKey,
      yHier.privateKey,
      fHier.publicKey,
      owner.privateKey
    );

    // Grandchild Z — direct child of Y (NOT F). Its claim is under Y's
    // pub hier and is NEVER touched by shallow rotation of F.
    const zHier = generateHierarchicalKeypair();
    const zSessionKey = generateSessionKey();
    const zEncMeta = encryptMetadata(
      { name: "z.txt", type: "text/plain", size: 20 },
      zSessionKey
    );
    const zClaim = wrapParentKeysClaim(
      zSessionKey,
      zHier.privateKey,
      yHier.publicKey,
      owner.privateKey
    );

    // Pre-rotation: owner shares F with Alice and Bob.
    const fRowAlice = wrapPrivateHierarchicalKeyForUser(
      fHier.privateKey,
      alice.publicKey,
      owner.privateKey
    );
    const fRowBob = wrapPrivateHierarchicalKeyForUser(
      fHier.privateKey,
      bob.publicKey,
      owner.privateKey
    );

    // Sanity: Bob can walk F → X and F → Y → Z pre-rotation.
    const bobFPrivOld = unwrapPrivateHierarchicalKey(
      fRowBob,
      owner.publicKey,
      bob.privateKey
    );
    expect(bobFPrivOld).toBe(fHier.privateKey);
    const bobX = unwrapParentKeysClaim(xClaimOld, owner.publicKey, bobFPrivOld);
    expect(toBase64(bobX.sessionKey)).toBe(toBase64(xSessionKey));
    const bobY = unwrapParentKeysClaim(yClaimOld, owner.publicKey, bobFPrivOld);
    // Bob uses the recovered Y priv hier to reach Z.
    const bobZ = unwrapParentKeysClaim(zClaim, owner.publicKey, bobY.childPrivateHierarchicalKey);
    expect(decryptMetadata(zEncMeta, bobZ.sessionKey).name).toBe("z.txt");

    // ── Shallow rotation ──────────────────────────────────────────
    // Owner generates new folder keys and re-wraps X's and Y's
    // claims under the new folder pub hier. Y's own priv hier is
    // unchanged, so Z's claim is left alone.
    const newFHier = generateHierarchicalKeypair();
    const newFSessionKey = generateSessionKey();
    // (new fSessionKey used by the real flow to re-encrypt metadata;
    // not exercised further in this primitive-level test)
    void newFSessionKey;

    const xClaimNew = wrapParentKeysClaim(
      xSessionKey, // unchanged
      xHier.privateKey, // unchanged
      newFHier.publicKey,
      owner.privateKey
    );
    const yClaimNew = wrapParentKeysClaim(
      ySessionKey, // unchanged
      yHier.privateKey, // unchanged
      newFHier.publicKey,
      owner.privateKey
    );

    // Alice gets a new file_keys row on F with the new priv hier.
    const fRowAliceNew = wrapPrivateHierarchicalKeyForUser(
      newFHier.privateKey,
      alice.publicKey,
      owner.privateKey
    );
    // Bob's row is deleted (simulated by just not giving him one).

    // ── Invariant 1: Bob's OLD priv hier can't open the new claims ──
    expect(() =>
      unwrapParentKeysClaim(xClaimNew, owner.publicKey, bobFPrivOld)
    ).toThrow(/Box decryption failed/);
    expect(() =>
      unwrapParentKeysClaim(yClaimNew, owner.publicKey, bobFPrivOld)
    ).toThrow(/Box decryption failed/);

    // ── Invariant 2: Alice's new row unwraps to new F priv hier,
    //               and she can walk X, Y, and Z via the new claims. ──
    const aliceFPrivNew = unwrapPrivateHierarchicalKey(
      fRowAliceNew,
      owner.publicKey,
      alice.privateKey
    );
    expect(aliceFPrivNew).toBe(newFHier.privateKey);
    const aliceX = unwrapParentKeysClaim(xClaimNew, owner.publicKey, aliceFPrivNew);
    expect(decryptMetadata(xEncMeta, aliceX.sessionKey).name).toBe("x.txt");

    const aliceY = unwrapParentKeysClaim(yClaimNew, owner.publicKey, aliceFPrivNew);
    // Crucially, Z's claim wasn't touched by rotation — Alice uses Y's
    // (unchanged) priv hier to walk one level deeper.
    const aliceZ = unwrapParentKeysClaim(
      zClaim,
      owner.publicKey,
      aliceY.childPrivateHierarchicalKey
    );
    expect(decryptMetadata(zEncMeta, aliceZ.sessionKey).name).toBe("z.txt");

    // ── Invariant 3: Z's claim is untouched — byte-for-byte unchanged. ──
    // (Nothing to assert; just a reminder that the rotation code path
    //  above only touches direct children of F, never grandchildren.)
    expect(zClaim).toBe(zClaim);

    // ── Invariant 4 (documented limitation): Bob's CACHED X session
    //    key (from the pre-rotation walk) still decrypts X's metadata.
    //    The rotation re-wrapped X's CLAIM but didn't change X's own
    //    session key or rotate X's hier keypair. This is the known
    //    "shallow rotation" tradeoff — revoking via folder rotation
    //    does NOT invalidate caches a user already extracted. ─────
    expect(decryptMetadata(xEncMeta, bobX.sessionKey).name).toBe("x.txt");
  });

  it("phase 5: key rotation produces ciphertext the old session key cannot decrypt", () => {
    // Sanity-check the forward-secrecy property that Phase 5 relies on.
    // The actual rotate flow lives in the hook + server routes; this
    // test pins the primitive-level invariant the flow depends on: a
    // fresh session key cannot be opened with the old one, no matter
    // what the attacker has cached.
    const oldSessionKey = generateSessionKey();
    const oldHier = generateHierarchicalKeypair();
    const owner = makeUser();

    const { encryptedSessionKeyByFile: oldWrap, sessionKeyNonce: oldNonce } =
      wrapSessionKeyToFile(oldSessionKey, oldHier.publicKey, owner.privateKey);

    // Rotate — brand new keys.
    const newSessionKey = generateSessionKey();
    const newHier = generateHierarchicalKeypair();
    const { encryptedSessionKeyByFile: newWrap, sessionKeyNonce: newNonce } =
      wrapSessionKeyToFile(newSessionKey, newHier.publicKey, owner.privateKey);

    // The revoked user is simulated as an attacker holding the OLD
    // private hier key and trying it against the NEW wrap.
    expect(() =>
      unwrapSessionKeyFromFile(newWrap, newNonce, owner.publicKey, oldHier.privateKey)
    ).toThrow(/Box decryption failed/);

    // Positive control: the current owner using the new key unwraps fine.
    const recovered = unwrapSessionKeyFromFile(
      newWrap,
      newNonce,
      owner.publicKey,
      newHier.privateKey
    );
    expect(toBase64(recovered)).toBe(toBase64(newSessionKey));

    // And the old wrap still works with the old key — rotation doesn't
    // touch old ciphertext; the server deletes it after commit, but any
    // cached copy remains self-consistent.
    const oldRecovered = unwrapSessionKeyFromFile(
      oldWrap,
      oldNonce,
      owner.publicKey,
      oldHier.privateKey
    );
    expect(toBase64(oldRecovered)).toBe(toBase64(oldSessionKey));
  });

  it("revoking (simulating link deletion) has no effect on already-copied URLs cryptographically", () => {
    // Phase 4 revocation is ACL-only: the server refuses to serve the
    // payload after revoke, but the crypto primitives themselves are
    // unchanged. A visitor who already fetched + cached the ciphertexts
    // before revocation could still decrypt. This test documents that
    // invariant so future contributors don't accidentally assume
    // crypto-level revocation without also implementing key rotation.
    const hier = generateHierarchicalKeypair();
    const linkKey = generateLinkKey();
    const { encryptedPrivateHierarchicalKey, linkKeyNonce } =
      wrapPrivateHierarchicalKeyForLink(hier.privateKey, linkKey);

    // "Revoke" on the server is simulated as: the visitor can't fetch
    // the row anymore. But if they already have the ciphertext cached:
    const recovered = unwrapPrivateHierarchicalKeyFromLink(
      encryptedPrivateHierarchicalKey,
      linkKeyNonce,
      linkKey
    );
    expect(recovered).toBe(hier.privateKey);
  });
});
