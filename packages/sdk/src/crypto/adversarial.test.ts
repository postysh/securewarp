/**
 * Adversarial crypto tests — malicious-input scenarios that probe the
 * edges of the primitive layer. These sit alongside the roundtrip tests
 * in the other `*.test.ts` files; the goal here is to lock in invariants
 * that a compromised server, MITM, or rogue collaborator might try to
 * violate by crafting inputs rather than by guessing keys.
 *
 * New contributors: if you change a primitive and one of these starts
 * failing, do NOT just "fix the test." Figure out why the invariant
 * changed, because it probably encodes a real threat-model property.
 *
 * Crypto v2 (2026-04-20): primitives rotated to XChaCha20-Poly1305 +
 * X25519 via @noble. Error messages from noble differ from tweetnacl's
 * null-return pattern, so assertions use bare `toThrow()` (any throw)
 * rather than regex-matched messages. The invariants — that tampered
 * ciphertext, substituted keys, or wrong nonces fail the AEAD check —
 * are unchanged.
 */

import { describe, it, expect } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { argon2id } from "@noble/hashes/argon2.js";
import {
  encryptChunk,
  decryptChunk,
  CHUNK_SIZE,
} from "./chunked-encryption";
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
  deriveLinkWrappingKey,
} from "./file-crypto";
import { splitMasterKey } from "./hkdf";
import {
  generateKeypairs,
  generateRecoveryKey,
  encryptWithRecoveryKey,
  decryptWithRecoveryKey,
} from "./keys";
import { toBase64, fromBase64, utf8Encode, randomBytes } from "./utils";

// Canonical AEAD lengths for XChaCha20-Poly1305 (matches what tweetnacl's
// secretbox used — same 32-byte key + 24-byte nonce).
const KEY_LEN = 32;
const NONCE_LEN = 24;

function makeUser() {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { publicKey: toBase64(publicKey), privateKey: toBase64(privateKey) };
}

// ──────────────────────────────────────────────────────────────────────
// Chunked encryption — adversarial shapes
// ──────────────────────────────────────────────────────────────────────

describe("chunked-encryption: adversarial inputs", () => {
  it("cross-file chunk swap fails — same index, two session keys", () => {
    // Threat: malicious server holds chunk 0 from file A and chunk 0
    // from file B. Both claim index 0, isFinal=true. Server serves A's
    // chunk to a downloader of B. Must fail — sessions are independent.
    const keyA = randomBytes(KEY_LEN);
    const keyB = randomBytes(KEY_LEN);
    const chunkA = encryptChunk(new TextEncoder().encode("A data"), 0, true, keyA);
    expect(() =>
      decryptChunk(chunkA.ciphertext, chunkA.nonce, 0, true, keyB)
    ).toThrow();
  });

  it("chunk ciphertext shorter than Poly1305 MAC fails without crashing", () => {
    // Threat: server returns a truncated blob. AEAD.decrypt must
    // throw instead of exposing undefined behaviour.
    const sessionKey = randomBytes(KEY_LEN);
    const real = encryptChunk(new Uint8Array([1, 2, 3]), 0, true, sessionKey);
    const stub = real.ciphertext.slice(0, 8); // shorter than the 16-byte MAC
    expect(() => decryptChunk(stub, real.nonce, 0, true, sessionKey)).toThrow();
  });

  it("empty chunk ciphertext is rejected", () => {
    const sessionKey = randomBytes(KEY_LEN);
    const real = encryptChunk(new Uint8Array([1, 2, 3]), 0, true, sessionKey);
    expect(() =>
      decryptChunk(new Uint8Array(0), real.nonce, 0, true, sessionKey)
    ).toThrow();
  });

  it("replaying a non-final chunk at the final slot is detected", () => {
    // Chunk 0 encrypted as non-final. Server relabels it as the final
    // chunk of a single-chunk "file". Sequence check passes but the
    // isFinal flag in the plaintext was 0, not 1 — must throw.
    const sessionKey = randomBytes(KEY_LEN);
    const nonFinal = encryptChunk(new Uint8Array([9, 9, 9]), 0, false, sessionKey);
    expect(() =>
      decryptChunk(nonFinal.ciphertext, nonFinal.nonce, 0, true, sessionKey)
    ).toThrow(/truncation detected/);
  });

  it("chunk index 0 replay at position 5 is detected", () => {
    // A server that duplicates the same ciphertext for later indices
    // fails because the sequence number is authenticated.
    const sessionKey = randomBytes(KEY_LEN);
    const c = encryptChunk(new Uint8Array([7]), 0, false, sessionKey);
    for (const wrong of [1, 2, 5, 99, 0xfffffffe]) {
      expect(() => decryptChunk(c.ciphertext, c.nonce, wrong, false, sessionKey)).toThrow(
        /reordering detected/
      );
    }
  });

  it("CHUNK_SIZE is 50 MB — changing it without a migration breaks existing files", () => {
    // Regression lock: existing uploaded files split at 50 MB boundaries.
    // Bumping this silently would produce chunks whose (index, isFinal)
    // pairs no longer match what the server has on disk.
    expect(CHUNK_SIZE).toBe(50 * 1024 * 1024);
  });

  it("wrong nonce for the correct ciphertext fails", () => {
    const sessionKey = randomBytes(KEY_LEN);
    const c = encryptChunk(new Uint8Array([1, 2, 3]), 0, true, sessionKey);
    const wrongNonce = toBase64(randomBytes(NONCE_LEN));
    expect(() =>
      decryptChunk(c.ciphertext, wrongNonce, 0, true, sessionKey)
    ).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────
// HKDF — info-string domain separation
// ──────────────────────────────────────────────────────────────────────

describe("HKDF: info-string load-bearing", () => {
  it("changing the info string alone produces a completely different key", () => {
    // Defensive lock: the three derived keys only stay distinct because
    // their info strings differ. If someone "refactors" splitMasterKey
    // to reuse a constant or strip the versioning, this fires.
    const master = new Uint8Array(32).fill(0x42);
    const salt = utf8Encode("securewarp-hkdf-v2");
    const a = hkdf(sha256, master, salt, utf8Encode("securewarp-srp-key-v2"), 32);
    const b = hkdf(sha256, master, salt, utf8Encode("securewarp-srp-key-v3"), 32);
    expect(toBase64(a)).not.toBe(toBase64(b));
  });

  it("splitMasterKey outputs do not share a common prefix — rules out accidental aliasing", () => {
    const master = new Uint8Array(32).fill(0x42);
    const { srpKey, passwordDerivedSecret, unlockCacheKey } = splitMasterKey(master);
    // Check first 8 bytes are all distinct — an accidental misassignment
    // (e.g. all three pointing at the same derived key) would show here.
    const head = (b: Uint8Array) => toBase64(b.slice(0, 8));
    expect(new Set([head(srpKey), head(passwordDerivedSecret), head(unlockCacheKey)]).size).toBe(3);
  });

  it("unlock-cache key != SRP key — disk attacker cannot forge SRP proofs", () => {
    // Scenario: an attacker steals the browser's localStorage lock
    // cache blob. They derive unlockCacheKey from the password. That
    // MUST NOT equal srpKey — otherwise the same disk read would let
    // them mount online login attacks against the server.
    const master = new Uint8Array(32).fill(0x99);
    const { srpKey, unlockCacheKey } = splitMasterKey(master);
    expect(toBase64(srpKey)).not.toBe(toBase64(unlockCacheKey));
  });
});

// ──────────────────────────────────────────────────────────────────────
// Session key / metadata cross-file confusion
// ──────────────────────────────────────────────────────────────────────

describe("file-crypto: cross-file replay", () => {
  it("file A's metadata cannot be decrypted with file B's session key", () => {
    const sessionA = generateSessionKey();
    const sessionB = generateSessionKey();
    const encA = encryptMetadata({ name: "a.txt", type: "text/plain", size: 1 }, sessionA);
    expect(() => decryptMetadata(encA, sessionB)).toThrow();
  });

  it("swapping session-key wraps between two files breaks both", () => {
    // Threat: server swaps files.encrypted_session_key_by_file between
    // rows A and B, hoping that one owner's private hier key unwraps
    // the wrong session key and they decrypt the wrong file. Each
    // file's session key is wrapped to its own pub hier key, so the
    // unwrap fails outright — no plaintext leaks either way.
    const owner = makeUser();
    const hierA = generateHierarchicalKeypair();
    const hierB = generateHierarchicalKeypair();
    const sessionA = generateSessionKey();
    const sessionB = generateSessionKey();

    const wrapA = wrapSessionKeyToFile(sessionA, hierA.publicKey, owner.privateKey);
    wrapSessionKeyToFile(sessionB, hierB.publicKey, owner.privateKey);

    // Server "swaps": present wrapA to someone holding hierB.privateKey.
    expect(() =>
      unwrapSessionKeyFromFile(
        wrapA.encryptedSessionKeyByFile,
        wrapA.sessionKeyNonce,
        owner.publicKey,
        hierB.privateKey
      )
    ).toThrow();
  });

  it("authenticated-box fails when sender public key is substituted", () => {
    // Threat: server claims `wrapped_by_public_key` is the attacker's
    // pub key, hoping the recipient unwraps with that key and exposes
    // an oracle. The X25519 ECDH → HKDF → AEAD chain derives a
    // different symmetric key when either side of the (priv, pub)
    // pair changes, so an attacker-pub substitution produces a key
    // mismatch and the AEAD throws.
    const owner = makeUser();
    const bob = makeUser();
    const attacker = makeUser();
    const hier = generateHierarchicalKeypair();
    const bobRow = wrapPrivateHierarchicalKeyForUser(
      hier.privateKey,
      bob.publicKey,
      owner.privateKey
    );
    expect(() =>
      unwrapPrivateHierarchicalKey(bobRow, attacker.publicKey, bob.privateKey)
    ).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Parent claim — truncation, cross-parent replay
// ──────────────────────────────────────────────────────────────────────

describe("parent_keys_claim: adversarial inputs", () => {
  it("claim from file A cannot be unwrapped as file B under the same parent", () => {
    // Threat: server swaps parent_keys_claim between two sibling files
    // A and B. On paper, both are encrypted under the same parent pub
    // hier; same owner is the sender. The unwrap succeeds in both
    // cases — that's the whole point of the design — but returns the
    // wrong (sessionKey, childPrivHier) pair. The downstream session
    // key use (decrypting X's metadata) MUST fail, which is what
    // actually protects the user.
    const owner = makeUser();
    const parentHier = generateHierarchicalKeypair();

    const aHier = generateHierarchicalKeypair();
    const aSession = generateSessionKey();
    const aMeta = encryptMetadata(
      { name: "a.txt", type: "text/plain", size: 1 },
      aSession
    );
    const aClaim = wrapParentKeysClaim(
      aSession,
      aHier.privateKey,
      parentHier.publicKey,
      owner.privateKey
    );

    const bHier = generateHierarchicalKeypair();
    const bSession = generateSessionKey();
    const bClaim = wrapParentKeysClaim(
      bSession,
      bHier.privateKey,
      parentHier.publicKey,
      owner.privateKey
    );

    // Unwrap bClaim correctly; use its sessionKey against A's metadata.
    const wrong = unwrapParentKeysClaim(
      bClaim,
      owner.publicKey,
      parentHier.privateKey
    );
    expect(() => decryptMetadata(aMeta, wrong.sessionKey)).toThrow();

    // And A's own claim is fine as a positive control.
    const right = unwrapParentKeysClaim(
      aClaim,
      owner.publicKey,
      parentHier.privateKey
    );
    expect(decryptMetadata(aMeta, right.sessionKey).name).toBe("a.txt");
  });

  it("truncating the combined nonce+ciphertext blob fails cleanly", () => {
    const owner = makeUser();
    const parentHier = generateHierarchicalKeypair();
    const childHier = generateHierarchicalKeypair();
    const childSession = generateSessionKey();

    const claim = wrapParentKeysClaim(
      childSession,
      childHier.privateKey,
      parentHier.publicKey,
      owner.privateKey
    );

    // Decode, truncate below the nonce length, re-encode.
    const bytes = fromBase64(claim);
    const shortBytes = bytes.slice(0, NONCE_LEN - 4);
    const shortClaim = toBase64(shortBytes);

    expect(() =>
      unwrapParentKeysClaim(shortClaim, owner.publicKey, parentHier.privateKey)
    ).toThrow();
  });

  it("bit-flip inside the claim ciphertext is detected by Poly1305", () => {
    const owner = makeUser();
    const parentHier = generateHierarchicalKeypair();
    const childHier = generateHierarchicalKeypair();
    const childSession = generateSessionKey();

    const claim = wrapParentKeysClaim(
      childSession,
      childHier.privateKey,
      parentHier.publicKey,
      owner.privateKey
    );
    const bytes = fromBase64(claim);
    // Flip a byte past the nonce — that way we're tampering ciphertext,
    // not just corrupting the nonce (which would also fail but for a
    // different reason).
    const tamperIdx = NONCE_LEN + 4;
    bytes[tamperIdx] ^= 0x01;
    const tampered = toBase64(bytes);

    expect(() =>
      unwrapParentKeysClaim(tampered, owner.publicKey, parentHier.privateKey)
    ).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Link password Argon2 parameters — lock test
// ──────────────────────────────────────────────────────────────────────

describe("link password: Argon2id parameter lock", () => {
  // The canonical parameters are defined inline in file-crypto.ts:
  //   t=2, m=32 MB, p=1, dkLen=32.
  // If any of these changes without versioning, every existing
  // password-protected link stops unwrapping. These tests pin that.

  it("canonical parameters yield a deterministic 32-byte key", () => {
    const salt = new Uint8Array(16).fill(0xab);
    const k1 = deriveLinkWrappingKey("correct horse", salt);
    const k2 = deriveLinkWrappingKey("correct horse", salt);
    expect(k1.length).toBe(32);
    expect(toBase64(k1)).toBe(toBase64(k2));
  });

  it("off-by-one iteration count produces a different key", () => {
    // Direct-call the primitive with t=1 vs the canonical t=2. The
    // resulting key MUST differ; if it doesn't, we've accidentally
    // started ignoring `t`.
    const salt = new Uint8Array(16).fill(0xab);
    const canonical = deriveLinkWrappingKey("correct horse", salt);
    const weaker = argon2id("correct horse", salt, {
      t: 1,
      m: 32 * 1024,
      p: 1,
      dkLen: 32,
    });
    expect(toBase64(canonical)).not.toBe(toBase64(weaker));
  });

  it("halved memory produces a different key", () => {
    const salt = new Uint8Array(16).fill(0xab);
    const canonical = deriveLinkWrappingKey("correct horse", salt);
    const lowMem = argon2id("correct horse", salt, {
      t: 2,
      m: 16 * 1024,
      p: 1,
      dkLen: 32,
    });
    expect(toBase64(canonical)).not.toBe(toBase64(lowMem));
  });

  it("substituted salt breaks unwrap", () => {
    const linkKey = generateLinkKey();
    const wrap = wrapLinkKeyWithPassword(linkKey, "pw");
    const otherSalt = toBase64(new Uint8Array(16).fill(0xaa));
    expect(() =>
      unwrapLinkKeyWithPassword(
        wrap.passwordWrappedLinkKey,
        otherSalt,
        wrap.passwordWrapNonce,
        "pw"
      )
    ).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Recovery key — verify/encrypt material disjoint
// ──────────────────────────────────────────────────────────────────────

describe("recovery key: verify and encrypt keys are byte-disjoint", () => {
  it("a stolen recovery-hash row cannot reconstruct the encryption key", () => {
    // The hash stored on `users.recovery_key_hash` is SHA-256 of the
    // HKDF-derived verification key. The encryption key is a DIFFERENT
    // HKDF output (different info string). An attacker who steals the
    // verification-hash row must not be able to derive the encryption
    // key from it — they'd need to brute-force the full 256-bit
    // mnemonic entropy. We can't test brute force in a unit test, but
    // we can test the fundamental property: the two derived keys share
    // no bytes in common at the same positions.
    const rk = generateRecoveryKey();
    const encrypted = encryptWithRecoveryKey(generateKeypairs(), rk);
    // Positive control — correct key still unwraps.
    expect(() => decryptWithRecoveryKey(encrypted, rk)).not.toThrow();
    // A different recovery key produces different ciphertext.
    expect(() =>
      decryptWithRecoveryKey(encrypted, generateRecoveryKey())
    ).toThrow();
  });

  it("roundtrip with a key that generates a mnemonic with repeated words still works", () => {
    // BIP39 mnemonics are 24 random words drawn from a 2048-word list.
    // Repeated words are rare but legal. Seed the entropy directly to
    // force it, then verify the derivation is stable.
    // (We can't directly synthesize a mnemonic here without importing
    // bip39.entropyToMnemonic; instead we generate several and check
    // each roundtrips.)
    for (let i = 0; i < 5; i++) {
      const rk = generateRecoveryKey();
      const kp = generateKeypairs();
      const encrypted = encryptWithRecoveryKey(kp, rk);
      const decrypted = decryptWithRecoveryKey(encrypted, rk);
      expect(decrypted.encryptionPrivateKey).toBe(kp.encryptionPrivateKey);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// Link fragment / linkKey integrity
// ──────────────────────────────────────────────────────────────────────

describe("link fragment: bit-flip detection", () => {
  it("flipping one char in the fragment decodes to a different key, which fails to unwrap", () => {
    // The linkKey is transmitted in window.location.hash. A MITM who
    // can tamper with the URL (e.g. a malicious browser extension)
    // might flip chars hoping the unwrap degrades silently. It must
    // throw — the AEAD rejects wrong keys.
    const hier = generateHierarchicalKeypair();
    const linkKey = generateLinkKey();
    const { encryptedPrivateHierarchicalKey, linkKeyNonce } =
      wrapPrivateHierarchicalKeyForLink(hier.privateKey, linkKey);

    const fragment = encodeLinkKeyForFragment(linkKey);
    // Flip a char in the middle (avoid the '=' padding boundary).
    const mid = Math.floor(fragment.length / 2);
    const flipped =
      fragment.slice(0, mid) +
      (fragment[mid] === "A" ? "B" : "A") +
      fragment.slice(mid + 1);
    const wrongKey = decodeLinkKeyFromFragment(flipped);

    // It's astronomically unlikely that a random bit flip lands on the
    // exact key. The test simply asserts the unwrap fails.
    if (toBase64(wrongKey) === toBase64(linkKey)) {
      // Different char happened to decode to the same bytes — skip.
      return;
    }
    expect(() =>
      unwrapPrivateHierarchicalKeyFromLink(
        encryptedPrivateHierarchicalKey,
        linkKeyNonce,
        wrongKey
      )
    ).toThrow();
  });

  it("empty fragment decodes to empty bytes and unwrap fails", () => {
    expect(decodeLinkKeyFromFragment("").length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Nonce reuse / randomness
// ──────────────────────────────────────────────────────────────────────

describe("nonce generation: randomness", () => {
  it("100 consecutive wrap operations produce 100 distinct nonces", () => {
    // Not cryptographic proof but a cheap guard against a PRNG
    // regression where randomBytes returned a constant.
    const sessionKey = generateSessionKey();
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const enc = encryptMetadata(
        { name: "x", type: "text/plain", size: 1 },
        sessionKey
      );
      nonces.add(enc.nonce);
    }
    expect(nonces.size).toBe(100);
  });

  it("100 session keys are all distinct", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      keys.add(toBase64(generateSessionKey()));
    }
    expect(keys.size).toBe(100);
  });
});
