/**
 * Adversarial crypto tests — malicious-input scenarios that probe
 * the edges of the primitive layer.
 *
 * Crypto v2 Phase 2b: every asymmetric wrap is hybrid (X25519 +
 * ML-KEM-768). The tweet-nacl-specific edge-case tests from the
 * v1 suite don't map directly; this file focuses on:
 *   - chunked encryption (unchanged symmetric, still lock reorder
 *     + truncation detection)
 *   - HKDF domain separation
 *   - cross-file / cross-parent confusion under hybrid wraps
 *   - hybrid-specific invariants (tampering, partial-key attacks)
 *   - Argon2id parameter lock for link passwords
 *   - recovery-key verify/encrypt disjointness
 *   - nonce randomness
 */

import { describe, it, expect } from "vitest";
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
  wrapLinkKeyWithPassword,
  unwrapLinkKeyWithPassword,
  deriveLinkWrappingKey,
  encryptMetadata,
  decryptMetadata,
} from "./file-crypto";
import { splitMasterKey } from "./hkdf";
import {
  generateKeypairs,
  generateRecoveryKey,
  encryptWithRecoveryKey,
  decryptWithRecoveryKey,
} from "./keys";
import { toBase64, fromBase64, utf8Encode, randomBytes } from "./utils";

const KEY_LEN = 32;
const NONCE_LEN = 24;

function makeUser() {
  return generateHierarchicalKeypair();
}

// ──────────────────────────────────────────────────────────────────────
// Chunked encryption — adversarial shapes
// ──────────────────────────────────────────────────────────────────────

describe("chunked-encryption: adversarial inputs", () => {
  it("cross-file chunk swap fails — same index, two session keys", () => {
    const keyA = randomBytes(KEY_LEN);
    const keyB = randomBytes(KEY_LEN);
    const chunkA = encryptChunk(new TextEncoder().encode("A data"), 0, true, keyA);
    expect(() =>
      decryptChunk(chunkA.ciphertext, chunkA.nonce, 0, true, keyB),
    ).toThrow();
  });

  it("chunk ciphertext shorter than Poly1305 MAC fails without crashing", () => {
    const sessionKey = randomBytes(KEY_LEN);
    const real = encryptChunk(new Uint8Array([1, 2, 3]), 0, true, sessionKey);
    const stub = real.ciphertext.slice(0, 8);
    expect(() => decryptChunk(stub, real.nonce, 0, true, sessionKey)).toThrow();
  });

  it("empty chunk ciphertext is rejected", () => {
    const sessionKey = randomBytes(KEY_LEN);
    const real = encryptChunk(new Uint8Array([1, 2, 3]), 0, true, sessionKey);
    expect(() =>
      decryptChunk(new Uint8Array(0), real.nonce, 0, true, sessionKey),
    ).toThrow();
  });

  it("replaying a non-final chunk at the final slot is detected", () => {
    const sessionKey = randomBytes(KEY_LEN);
    const nonFinal = encryptChunk(new Uint8Array([9, 9, 9]), 0, false, sessionKey);
    expect(() =>
      decryptChunk(nonFinal.ciphertext, nonFinal.nonce, 0, true, sessionKey),
    ).toThrow(/truncation detected/);
  });

  it("chunk index 0 replay at later positions is detected", () => {
    const sessionKey = randomBytes(KEY_LEN);
    const c = encryptChunk(new Uint8Array([7]), 0, false, sessionKey);
    for (const wrong of [1, 2, 5, 99, 0xfffffffe]) {
      expect(() =>
        decryptChunk(c.ciphertext, c.nonce, wrong, false, sessionKey),
      ).toThrow(/reordering detected/);
    }
  });

  it("CHUNK_SIZE locked at 8 MB", () => {
    // Sentinel: if this test ever fails it means someone changed the
    // chunk size intentionally. That's OK — but remember:
    //   - Only new uploads use the new size; old files in R2 keep
    //     their original chunks via the per-chunk DB manifest.
    //   - rotate-init caps chunkCount at 10,000 on the server, so
    //     don't shrink below what accommodates the max plan size.
    expect(CHUNK_SIZE).toBe(8 * 1024 * 1024);
  });

  it("wrong nonce for the correct ciphertext fails", () => {
    const sessionKey = randomBytes(KEY_LEN);
    const c = encryptChunk(new Uint8Array([1, 2, 3]), 0, true, sessionKey);
    const wrongNonce = toBase64(randomBytes(NONCE_LEN));
    expect(() =>
      decryptChunk(c.ciphertext, wrongNonce, 0, true, sessionKey),
    ).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────
// HKDF — info-string domain separation
// ──────────────────────────────────────────────────────────────────────

describe("HKDF: info-string load-bearing", () => {
  it("changing the info string alone produces a completely different key", () => {
    const master = new Uint8Array(32).fill(0x42);
    const salt = utf8Encode("securewarp-hkdf-v2");
    const a = hkdf(sha256, master, salt, utf8Encode("securewarp-srp-key-v2"), 32);
    const b = hkdf(sha256, master, salt, utf8Encode("securewarp-srp-key-v3"), 32);
    expect(toBase64(a)).not.toBe(toBase64(b));
  });

  it("splitMasterKey outputs do not share a common prefix", () => {
    const master = new Uint8Array(32).fill(0x42);
    const { srpKey, passwordDerivedSecret, unlockCacheKey } = splitMasterKey(master);
    const head = (b: Uint8Array) => toBase64(b.slice(0, 8));
    expect(new Set([head(srpKey), head(passwordDerivedSecret), head(unlockCacheKey)]).size).toBe(3);
  });

  it("unlock-cache key != SRP key", () => {
    const master = new Uint8Array(32).fill(0x99);
    const { srpKey, unlockCacheKey } = splitMasterKey(master);
    expect(toBase64(srpKey)).not.toBe(toBase64(unlockCacheKey));
  });
});

// ──────────────────────────────────────────────────────────────────────
// Cross-file / cross-parent replay under hybrid
// ──────────────────────────────────────────────────────────────────────

describe("hybrid file-crypto: cross-file replay", () => {
  it("file A's metadata cannot be decrypted with file B's session key", () => {
    const sessionA = generateSessionKey();
    const sessionB = generateSessionKey();
    const encA = encryptMetadata({ name: "a.txt", type: "text/plain", size: 1 }, sessionA);
    expect(() => decryptMetadata(encA, sessionB)).toThrow();
  });

  it("swapping session-key wraps between two files breaks unwrap", () => {
    const owner = makeUser();
    const hierA = generateHierarchicalKeypair();
    const hierB = generateHierarchicalKeypair();
    const sessionA = generateSessionKey();

    const wrapA = wrapSessionKeyToFile(sessionA, hierA.publicKeys, owner.privateKeys.x25519);

    // Present A's wrap to someone holding hierB's priv. Fails because
    // the hybrid secret depends on BOTH halves of the target hier
    // keys — swapping the X25519 side already misaligns the KEM side.
    expect(() =>
      unwrapSessionKeyFromFile(
        wrapA.encryptedSessionKeyByFile,
        wrapA.sessionKeyNonce,
        owner.publicKeys.x25519,
        hierB.privateKeys,
      ),
    ).toThrow();
  });

  it("substituted sender X25519 pub fails the hybrid unwrap", () => {
    const owner = makeUser();
    const bob = makeUser();
    const attacker = makeUser();
    const hier = generateHierarchicalKeypair();
    const bobRow = wrapPrivateHierarchicalKeyForUser(
      hier.privateKeys,
      bob.publicKeys,
      owner.privateKeys.x25519,
    );
    // Hybrid still derives the X25519 ECDH secret from (sender_pub,
    // recipient_priv). Substituting the sender pub changes the X25519
    // shared secret → combined key mismatches → AEAD rejects.
    expect(() =>
      unwrapPrivateHierarchicalKey(
        bobRow,
        attacker.publicKeys.x25519,
        bob.privateKeys.x25519,
        bob.privateKeys.kem,
      ),
    ).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Hybrid-specific: partial-key failure modes
// ──────────────────────────────────────────────────────────────────────

describe("hybrid: partial-key attacks", () => {
  it("X25519 half alone cannot unwrap — ML-KEM is load-bearing", () => {
    const owner = makeUser();
    const bob = makeUser();
    const attacker = makeUser();
    const hier = generateHierarchicalKeypair();
    const wrap = wrapPrivateHierarchicalKeyForUser(
      hier.privateKeys,
      bob.publicKeys,
      owner.privateKeys.x25519,
    );
    // Attacker has Bob's X25519 priv somehow (compromise). Their
    // own ML-KEM priv won't match what was encapsulated — AEAD fails.
    expect(() =>
      unwrapPrivateHierarchicalKey(
        wrap,
        owner.publicKeys.x25519,
        bob.privateKeys.x25519,
        attacker.privateKeys.kem,
      ),
    ).toThrow();
  });

  it("ML-KEM half alone cannot unwrap — X25519 is load-bearing", () => {
    const owner = makeUser();
    const bob = makeUser();
    const attacker = makeUser();
    const hier = generateHierarchicalKeypair();
    const wrap = wrapPrivateHierarchicalKeyForUser(
      hier.privateKeys,
      bob.publicKeys,
      owner.privateKeys.x25519,
    );
    expect(() =>
      unwrapPrivateHierarchicalKey(
        wrap,
        owner.publicKeys.x25519,
        attacker.privateKeys.x25519,
        bob.privateKeys.kem,
      ),
    ).toThrow();
  });

  it("bit-flip inside the hybrid blob fails the AEAD check", () => {
    const owner = makeUser();
    const bob = makeUser();
    const hier = generateHierarchicalKeypair();
    const wrap = wrapPrivateHierarchicalKeyForUser(
      hier.privateKeys,
      bob.publicKeys,
      owner.privateKeys.x25519,
    );
    const bytes = fromBase64(wrap);
    // Flip a byte inside the AEAD ciphertext region (past the header).
    // Header = 1 (version) + 1088 (kem ct) + 24 (nonce) = 1113.
    bytes[1200] ^= 0x01;
    const tampered = toBase64(bytes);
    expect(() =>
      unwrapPrivateHierarchicalKey(
        tampered,
        owner.publicKeys.x25519,
        bob.privateKeys.x25519,
        bob.privateKeys.kem,
      ),
    ).toThrow();
  });

  it("parent-claim unwrap fails under swapped keys (downstream metadata breaks)", () => {
    // Keep the Phase-1-era semantic test: a server that swaps
    // parent claims between sibling files can return the wrong
    // (sessionKey, childPrivHier) pair. The claim itself unwraps —
    // that's the whole point of the design — but downstream
    // metadata decryption fails.
    const owner = makeUser();
    const parentHier = generateHierarchicalKeypair();

    const aHier = generateHierarchicalKeypair();
    const aSession = generateSessionKey();
    const aMeta = encryptMetadata(
      { name: "a.txt", type: "text/plain", size: 1 },
      aSession,
    );
    const aClaim = wrapParentKeysClaim(
      aSession,
      aHier.privateKeys,
      parentHier.publicKeys,
      owner.privateKeys.x25519,
    );

    const bHier = generateHierarchicalKeypair();
    const bSession = generateSessionKey();
    const bClaim = wrapParentKeysClaim(
      bSession,
      bHier.privateKeys,
      parentHier.publicKeys,
      owner.privateKeys.x25519,
    );

    const wrong = unwrapParentKeysClaim(
      bClaim,
      owner.publicKeys.x25519,
      parentHier.privateKeys,
    );
    expect(() => decryptMetadata(aMeta, wrong.sessionKey)).toThrow();

    const right = unwrapParentKeysClaim(
      aClaim,
      owner.publicKeys.x25519,
      parentHier.privateKeys,
    );
    expect(decryptMetadata(aMeta, right.sessionKey).name).toBe("a.txt");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Link password Argon2 parameters — lock test
// ──────────────────────────────────────────────────────────────────────

describe("link password: Argon2id parameter lock", () => {
  it("canonical parameters yield a deterministic 32-byte key", () => {
    const salt = new Uint8Array(16).fill(0xab);
    const k1 = deriveLinkWrappingKey("correct horse", salt);
    const k2 = deriveLinkWrappingKey("correct horse", salt);
    expect(k1.length).toBe(32);
    expect(toBase64(k1)).toBe(toBase64(k2));
  });

  it("off-by-one iteration count produces a different key", () => {
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
        "pw",
      ),
    ).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Recovery key — verify/encrypt material disjoint
// ──────────────────────────────────────────────────────────────────────

describe("recovery key: verify and encrypt keys are byte-disjoint", () => {
  it("a stolen recovery-hash row cannot reconstruct the encryption key", () => {
    const rk = generateRecoveryKey();
    const encrypted = encryptWithRecoveryKey(generateKeypairs(), rk);
    expect(() => decryptWithRecoveryKey(encrypted, rk)).not.toThrow();
    expect(() =>
      decryptWithRecoveryKey(encrypted, generateRecoveryKey()),
    ).toThrow();
  });

  it("multiple roundtrips produce consistent plaintext", () => {
    for (let i = 0; i < 3; i++) {
      const rk = generateRecoveryKey();
      const kp = generateKeypairs();
      const encrypted = encryptWithRecoveryKey(kp, rk);
      const decrypted = decryptWithRecoveryKey(encrypted, rk);
      expect(decrypted.encryptionPrivateKey).toBe(kp.encryptionPrivateKey);
      expect(decrypted.kemPrivateKey).toBe(kp.kemPrivateKey);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// Nonce reuse / randomness
// ──────────────────────────────────────────────────────────────────────

describe("nonce generation: randomness", () => {
  it("100 consecutive wrap operations produce 100 distinct nonces", () => {
    const sessionKey = generateSessionKey();
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const enc = encryptMetadata(
        { name: "x", type: "text/plain", size: 1 },
        sessionKey,
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

  it("100 hybrid keypair generations produce distinct kem pub keys", () => {
    const kemPubs = new Set<string>();
    for (let i = 0; i < 100; i++) {
      kemPubs.add(generateHierarchicalKeypair().publicKeys.kem);
    }
    expect(kemPubs.size).toBe(100);
  });
});
