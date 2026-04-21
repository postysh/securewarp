/**
 * File encryption — client-side only.
 *
 * Crypto v2 primitives (2026-04-20):
 *   - Symmetric AEAD: XChaCha20-Poly1305 via `@noble/ciphers` (replaces
 *     xsalsa20-poly1305 from tweetnacl). Same 32-byte key + 24-byte
 *     nonce shape, so storage layout is unchanged.
 *   - Asymmetric key wrap: X25519 ECDH via `@noble/curves` → HKDF-SHA256
 *     → XChaCha20-Poly1305 (replaces nacl.box). This is NaCl's own
 *     spec updated to modern primitives: ECDH shared secret, HKDF for
 *     key-derivation domain separation, then the modern AEAD.
 *
 * Phase 2 hierarchical key model (Skiff-style):
 *   - Every file has a random symmetric `sessionKey` for content + metadata.
 *   - Every file has an asymmetric `hierarchicalKeyPair` (X25519).
 *   - `sessionKey` is wrapped *once* to the file's public hierarchical key,
 *     using the owner's private key as the box sender. Stored on the file.
 *   - Each collaborator's file_keys row stores `privateHierarchicalKey`
 *     wrapped to *their* public encryption key by whoever granted access.
 *   - To read: collaborator unwraps privateHierarchicalKey → uses it to
 *     unwrap sessionKey → uses sessionKey for content.
 *
 * This design lets non-owners re-share (they hold privateHierarchicalKey),
 * makes adding a collaborator O(1) regardless of file size, and sets up
 * Phase 3 folder inheritance via parent_keys_claim.
 */

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { argon2id } from "@noble/hashes/argon2.js";
import { toBase64, fromBase64, randomBytes, utf8Encode } from "./utils";

// XChaCha20-Poly1305 spec: 32-byte key, 24-byte nonce, 16-byte Poly1305 tag.
// `xchacha20poly1305(key, nonce).encrypt(plaintext)` returns `plaintext||tag`.
const SECRETBOX_KEY_LEN = 32;
const SECRETBOX_NONCE_LEN = 24;

// Domain-separated HKDF params for the X25519 → symmetric-key derivation.
// Bumped to `-v2` for crypto v2 so any future rotation can ship as `-v3`
// without colliding with legacy blobs.
const BOX_HKDF_SALT = utf8Encode("securewarp-box-v2");
const BOX_HKDF_INFO = utf8Encode("securewarp-x25519-xchacha20poly1305-v2");

export interface EncryptedFile {
  encryptedContent: Uint8Array;  // raw ciphertext to upload to R2
  nonce: string;                 // base64
  sessionKey: string;            // base64 — the raw session key (encrypt this per-user)
}

export interface EncryptedMetadata {
  nonce: string;      // base64
  ciphertext: string; // base64
}

// ──────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────

function secretboxSeal(plaintext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
  return xchacha20poly1305(key, nonce).encrypt(plaintext);
}

function secretboxOpen(ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
  // Raw AEAD open. Noble throws with message "invalid tag" on
  // authentication failure. Callers that need a stable user-facing
  // message (e.g. "Box decryption failed", "Link unwrap failed",
  // "Wrong link password") wrap this in their own try/catch with the
  // appropriate text; leaving raw-throw here avoids one-size-fits-all
  // errors that lose context at the call site.
  return xchacha20poly1305(key, nonce).decrypt(ciphertext);
}

/**
 * Derive a symmetric AEAD key from an X25519 ECDH shared secret. Used
 * on both sides of a box wrap; given (senderPriv, recipientPub) or
 * (senderPub, recipientPriv), HKDF-SHA256 collapses the 32-byte shared
 * secret + domain-separated salt/info to a 32-byte XChaCha20-Poly1305
 * key. The resulting keys are deterministic for a given (priv, pub)
 * pair — we never transmit the derived key, only the fresh nonce and
 * the ciphertext.
 */
function deriveBoxKey(senderPriv: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  const shared = x25519.getSharedSecret(senderPriv, recipientPub);
  return hkdf(sha256, shared, BOX_HKDF_SALT, BOX_HKDF_INFO, SECRETBOX_KEY_LEN);
}

// Shared box wrap helper. Returns combined nonce‖ciphertext base64 plus
// the nonce separately (for cases where the storage schema splits them).
function boxWrap(
  message: Uint8Array,
  recipientPublicKey: string,
  senderPrivateKey: string
): { combined: string; nonceB64: string; ciphertextB64: string } {
  const recipientPub = fromBase64(recipientPublicKey);
  const senderPriv = fromBase64(senderPrivateKey);
  const key = deriveBoxKey(senderPriv, recipientPub);
  try {
    const nonce = randomBytes(SECRETBOX_NONCE_LEN);
    const ciphertext = secretboxSeal(message, nonce, key);
    const combined = new Uint8Array(nonce.length + ciphertext.length);
    combined.set(nonce);
    combined.set(ciphertext, nonce.length);
    return {
      combined: toBase64(combined),
      nonceB64: toBase64(nonce),
      ciphertextB64: toBase64(ciphertext),
    };
  } finally {
    key.fill(0);
  }
}

function boxOpenCombined(
  combinedB64: string,
  senderPublicKey: string,
  recipientPrivateKey: string
): Uint8Array {
  const combined = fromBase64(combinedB64);
  const nonce = combined.slice(0, SECRETBOX_NONCE_LEN);
  const ciphertext = combined.slice(SECRETBOX_NONCE_LEN);
  const recipientPriv = fromBase64(recipientPrivateKey);
  const senderPub = fromBase64(senderPublicKey);
  // Note the direction flip: on unwrap, the "sender" is the recipient
  // of the ECDH pair. X25519 is symmetric — (priv_A, pub_B) produces the
  // same shared secret as (priv_B, pub_A) — so we can derive with the
  // unwrapper's priv + wrapper's pub and get the same key.
  const key = deriveBoxKey(recipientPriv, senderPub);
  try {
    return secretboxOpen(ciphertext, nonce, key);
  } catch {
    throw new Error("Box decryption failed — wrong key or tampered ciphertext");
  } finally {
    key.fill(0);
  }
}

function boxOpenSplit(
  ciphertextB64: string,
  nonceB64: string,
  senderPublicKey: string,
  recipientPrivateKey: string
): Uint8Array {
  const ciphertext = fromBase64(ciphertextB64);
  const nonce = fromBase64(nonceB64);
  const recipientPriv = fromBase64(recipientPrivateKey);
  const senderPub = fromBase64(senderPublicKey);
  const key = deriveBoxKey(recipientPriv, senderPub);
  try {
    return secretboxOpen(ciphertext, nonce, key);
  } catch {
    throw new Error("Box decryption failed — wrong key or tampered ciphertext");
  } finally {
    key.fill(0);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Session key + content + metadata (symmetric AEAD)
// ──────────────────────────────────────────────────────────────────────

/**
 * Generate a random session key for a file.
 */
export function generateSessionKey(): Uint8Array {
  return randomBytes(SECRETBOX_KEY_LEN);
}

/**
 * Encrypt file content with a session key.
 */
export function encryptFileContent(content: Uint8Array, sessionKey: Uint8Array): {
  ciphertext: Uint8Array;
  nonce: string;
} {
  const nonce = randomBytes(SECRETBOX_NONCE_LEN);
  const ciphertext = secretboxSeal(content, nonce, sessionKey);
  return {
    ciphertext,
    nonce: toBase64(nonce),
  };
}

/**
 * Decrypt file content with a session key.
 */
export function decryptFileContent(ciphertext: Uint8Array, nonceB64: string, sessionKey: Uint8Array): Uint8Array {
  const nonce = fromBase64(nonceB64);
  return secretboxOpen(ciphertext, nonce, sessionKey);
}

/**
 * Encrypt file metadata (name, type, size) with the session key.
 */
export function encryptMetadata(
  metadata: { name: string; type: string; size: number },
  sessionKey: Uint8Array
): EncryptedMetadata {
  const payload = JSON.stringify(metadata);
  const nonce = randomBytes(SECRETBOX_NONCE_LEN);
  const messageBytes = new TextEncoder().encode(payload);
  const ciphertext = secretboxSeal(messageBytes, nonce, sessionKey);
  return {
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
  };
}

/**
 * Decrypt file metadata with the session key.
 */
export function decryptMetadata(
  encrypted: EncryptedMetadata,
  sessionKey: Uint8Array
): { name: string; type: string; size: number } {
  const nonce = fromBase64(encrypted.nonce);
  const ciphertext = fromBase64(encrypted.ciphertext);
  const plaintext = secretboxOpen(ciphertext, nonce, sessionKey);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

// ──────────────────────────────────────────────────────────────────────
// Hierarchical keypair (Phase 2)
// ──────────────────────────────────────────────────────────────────────

export interface HierarchicalKeypair {
  publicKey: string;  // base64
  privateKey: string; // base64
}

/**
 * Generate a fresh X25519 keypair for use as a file's hierarchical key.
 * Nothing distinguishes these from a user's own encryption keypair at the
 * crypto layer — only the role they play in the storage model differs.
 */
export function generateHierarchicalKeypair(): HierarchicalKeypair {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return {
    publicKey: toBase64(publicKey),
    privateKey: toBase64(privateKey),
  };
}

/**
 * Wrap a file's session key to its own public hierarchical key. The owner
 * is always the box sender — their public key is what a reader uses to
 * unwrap. Returns `ciphertext` + `nonce` as separate base64 strings so the
 * DB schema can store them in distinct columns.
 */
export function wrapSessionKeyToFile(
  sessionKey: Uint8Array,
  filePublicHierarchicalKey: string,
  ownerPrivateKey: string
): { encryptedSessionKeyByFile: string; sessionKeyNonce: string } {
  const { nonceB64, ciphertextB64 } = boxWrap(
    sessionKey,
    filePublicHierarchicalKey,
    ownerPrivateKey
  );
  return {
    encryptedSessionKeyByFile: ciphertextB64,
    sessionKeyNonce: nonceB64,
  };
}

/**
 * Unwrap a file's session key given its private hierarchical key and the
 * owner's public key (the box sender at upload time).
 */
export function unwrapSessionKeyFromFile(
  encryptedSessionKeyByFile: string,
  sessionKeyNonce: string,
  ownerPublicKey: string,
  filePrivateHierarchicalKey: string
): Uint8Array {
  return boxOpenSplit(
    encryptedSessionKeyByFile,
    sessionKeyNonce,
    ownerPublicKey,
    filePrivateHierarchicalKey
  );
}

/**
 * Wrap a file's private hierarchical key to a collaborator's public key.
 * Either the owner or any existing collaborator can call this — the
 * `wrappedByPublicKey` is the sharer's own public key, which the recipient
 * must use when unwrapping.
 */
export function wrapPrivateHierarchicalKeyForUser(
  filePrivateHierarchicalKey: string,
  recipientPublicKey: string,
  sharerPrivateKey: string
): string {
  const { combined } = boxWrap(
    fromBase64(filePrivateHierarchicalKey),
    recipientPublicKey,
    sharerPrivateKey
  );
  return combined;
}

/**
 * Unwrap your own file_keys row to recover the file's private hierarchical
 * key. `wrappedByPublicKey` is the sharer's public key at the time of the
 * grant (owner for initial rows, any collaborator for re-shares).
 */
export function unwrapPrivateHierarchicalKey(
  encryptedPrivateHierarchicalKey: string,
  wrappedByPublicKey: string,
  recipientPrivateKey: string
): string {
  const raw = boxOpenCombined(
    encryptedPrivateHierarchicalKey,
    wrappedByPublicKey,
    recipientPrivateKey
  );
  return toBase64(raw);
}

// ──────────────────────────────────────────────────────────────────────
// Link sharing — Phase 4
// ──────────────────────────────────────────────────────────────────────

/**
 * Fresh symmetric key for a public link. Lives only in the URL fragment
 * on the client; the server only ever sees the wrapped ciphertext.
 */
export function generateLinkKey(): Uint8Array {
  return randomBytes(SECRETBOX_KEY_LEN);
}

/**
 * Wrap a file's private hierarchical key under a link's symmetric key.
 * Uses XChaCha20-Poly1305 directly so no sender public key is involved —
 * anyone who holds `linkKey` can unwrap. `linkKey` lives only in the URL
 * fragment and is never transmitted to the server.
 */
export function wrapPrivateHierarchicalKeyForLink(
  privateHierarchicalKey: string, // base64
  linkKey: Uint8Array
): { encryptedPrivateHierarchicalKey: string; linkKeyNonce: string } {
  const nonce = randomBytes(SECRETBOX_NONCE_LEN);
  const ciphertext = secretboxSeal(fromBase64(privateHierarchicalKey), nonce, linkKey);
  return {
    encryptedPrivateHierarchicalKey: toBase64(ciphertext),
    linkKeyNonce: toBase64(nonce),
  };
}

/**
 * Inverse of `wrapPrivateHierarchicalKeyForLink`. The recovered private
 * hier key is then fed into `unwrapSessionKeyFromFile` along with the
 * owner's public key (which the server can return — it's public).
 */
export function unwrapPrivateHierarchicalKeyFromLink(
  encryptedPrivateHierarchicalKey: string,
  linkKeyNonce: string,
  linkKey: Uint8Array
): string {
  let plain: Uint8Array;
  try {
    plain = secretboxOpen(
      fromBase64(encryptedPrivateHierarchicalKey),
      fromBase64(linkKeyNonce),
      linkKey,
    );
  } catch {
    throw new Error("Link unwrap failed — wrong key or tampered ciphertext");
  }
  return toBase64(plain);
}

/**
 * URL-safe base64 without padding. The linkKey lives in
 * `window.location.hash`; standard base64 can include `/` and `+` which
 * are fine in fragments but awkward in logs and copy-paste flows.
 */
export function encodeLinkKeyForFragment(linkKey: Uint8Array): string {
  return toBase64(linkKey).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeLinkKeyFromFragment(fragment: string): Uint8Array {
  const padded = fragment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return fromBase64(padded + pad);
}

// ──────────────────────────────────────────────────────────────────────
// Phase 4.1 — password-protected links
// ──────────────────────────────────────────────────────────────────────

// Argon2id parameters for link password derivation. Deliberately lighter
// than the SRP main-key parameters (64 MB / 3 iters) because link password
// entry is interactive on a variety of devices, but still strong enough
// to make offline brute force expensive. 32 MB / 2 iters is the RFC 9106
// "memory-constrained" recommendation.
const LINK_ARGON2_MEMORY_KB = 32 * 1024; // 32 MB
const LINK_ARGON2_ITERATIONS = 2;
const LINK_ARGON2_PARALLELISM = 1;
const LINK_KEY_LENGTH = SECRETBOX_KEY_LEN;

/**
 * Derive a 32-byte symmetric key from a link password using Argon2id.
 * Used to wrap the actual linkKey before storing on the server — the
 * password itself never leaves the browser and isn't stored anywhere.
 */
export function deriveLinkWrappingKey(password: string, salt: Uint8Array): Uint8Array {
  return argon2id(password, salt, {
    t: LINK_ARGON2_ITERATIONS,
    m: LINK_ARGON2_MEMORY_KB,
    p: LINK_ARGON2_PARALLELISM,
    dkLen: LINK_KEY_LENGTH,
  });
}

/**
 * Wrap a linkKey under a password-derived key. Returns all three fields
 * that live on a password-protected `file_links` row.
 */
export function wrapLinkKeyWithPassword(
  linkKey: Uint8Array,
  password: string
): { passwordSalt: string; passwordWrappedLinkKey: string; passwordWrapNonce: string } {
  const salt = randomBytes(16);
  const wrappingKey = deriveLinkWrappingKey(password, salt);
  try {
    const nonce = randomBytes(SECRETBOX_NONCE_LEN);
    const ciphertext = secretboxSeal(linkKey, nonce, wrappingKey);
    return {
      passwordSalt: toBase64(salt),
      passwordWrappedLinkKey: toBase64(ciphertext),
      passwordWrapNonce: toBase64(nonce),
    };
  } finally {
    wrappingKey.fill(0);
  }
}

/**
 * Recover a linkKey from its password wrap. Throws on wrong password —
 * the caller should translate that into a user-visible "wrong password"
 * without retrying (rate-limiting is the server's job).
 */
export function unwrapLinkKeyWithPassword(
  passwordWrappedLinkKey: string,
  passwordSalt: string,
  passwordWrapNonce: string,
  password: string
): Uint8Array {
  const wrappingKey = deriveLinkWrappingKey(password, fromBase64(passwordSalt));
  try {
    return secretboxOpen(
      fromBase64(passwordWrappedLinkKey),
      fromBase64(passwordWrapNonce),
      wrappingKey,
    );
  } catch {
    throw new Error("Wrong link password");
  } finally {
    wrappingKey.fill(0);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Parent keys claim — Phase 3 folder inheritance
// ──────────────────────────────────────────────────────────────────────

/**
 * Payload of a parent_keys_claim: the child's session key and its own
 * private hierarchical key, both base64. Wrapped once at upload time so
 * anyone who can unwrap the parent can unwrap every descendant without
 * per-child ACL fan-out.
 */
interface ParentClaimPayload {
  sessionKey: string;
  childPrivateHierarchicalKey: string;
}

/**
 * Wrap `{sessionKey, childPrivateHierarchicalKey}` under the *parent's*
 * public hierarchical key, with the owner's private encryption key as the
 * box sender. The result is a single base64 combined nonce‖ciphertext.
 *
 * At read time the unwrap needs the parent's *private* hier key (obtained
 * by the user unwrapping their file_keys row on the parent) and the owner's
 * public key (stored alongside as `parent_keys_claim_wrapped_by`).
 */
export function wrapParentKeysClaim(
  sessionKey: Uint8Array,
  childPrivateHierarchicalKey: string,
  parentPublicHierarchicalKey: string,
  ownerPrivateKey: string
): string {
  const payload: ParentClaimPayload = {
    sessionKey: toBase64(sessionKey),
    childPrivateHierarchicalKey,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const { combined } = boxWrap(bytes, parentPublicHierarchicalKey, ownerPrivateKey);
  return combined;
}

/**
 * Unwrap a parent_keys_claim using the parent's private hierarchical key.
 * Returns the child's session key (raw bytes) and its own private hier key
 * (base64). The caller is responsible for zeroing the returned sessionKey
 * as soon as it's done with it.
 */
export function unwrapParentKeysClaim(
  parentKeysClaim: string,
  wrappedByPublicKey: string,
  parentPrivateHierarchicalKey: string
): { sessionKey: Uint8Array; childPrivateHierarchicalKey: string } {
  const bytes = boxOpenCombined(
    parentKeysClaim,
    wrappedByPublicKey,
    parentPrivateHierarchicalKey
  );
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as ParentClaimPayload;
  return {
    sessionKey: fromBase64(payload.sessionKey),
    childPrivateHierarchicalKey: payload.childPrivateHierarchicalKey,
  };
}
