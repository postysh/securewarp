/**
 * File encryption — client-side only.
 *
 * Crypto v2 Phase 2b (2026-04-21): every asymmetric wrap is now a
 * hybrid of X25519 ECDH + ML-KEM-768 encapsulation, combined via
 * HKDF-SHA256 and sealed with XChaCha20-Poly1305. If EITHER
 * algorithm stays secure, the wrap stays secure. This defends
 * against a harvest-now-decrypt-later adversary who records our
 * ciphertext today and breaks Curve25519 in 10–15 years with a
 * quantum computer.
 *
 * Sender authentication is preserved via the X25519 static ECDH
 * half (same model as NaCl's box): the classical shared secret is
 * only derivable by a party holding the sender's long-term private
 * key. ML-KEM adds PQ confidentiality on top; it does not itself
 * authenticate the sender, which is consistent with the existing
 * design. Signed share-invites remain a separately-tracked
 * roadmap item.
 *
 * Hybrid blob layout (single base64 string):
 *   [version: 1 byte = 0x02]
 *   [ml_kem_ciphertext: 1088 bytes]
 *   [nonce: 24 bytes (XChaCha20-Poly1305)]
 *   [aead_ciphertext: plaintext ‖ 16-byte Poly1305 tag]
 *
 * Symmetric paths (file content, metadata, link-key wraps,
 * password-protected links) are unchanged — they already used
 * XChaCha20-Poly1305 directly in v2 Phase 1 and didn't touch
 * asymmetric crypto.
 *
 * Phase 2 hierarchical model (same structure as v1 Skiff design):
 *   - Every file has a random symmetric `sessionKey` for content
 *     + metadata.
 *   - Every file has a HYBRID hierarchical keypair (X25519 +
 *     ML-KEM-768).
 *   - `sessionKey` is wrapped *once* to the file's hybrid public
 *     hierarchical keys by the owner's X25519 private key (ECDH
 *     sender). Stored on the file.
 *   - Each collaborator's file_keys row wraps the hybrid
 *     `HierarchicalPrivateKeys` bundle to THEIR hybrid public user
 *     keys via whoever granted access.
 *   - To read: collaborator unwraps their file_keys row →
 *     unwraps session key → uses session key for content.
 */

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { argon2id } from "@noble/hashes/argon2.js";
import { toBase64, fromBase64, randomBytes, utf8Encode } from "./utils";

// XChaCha20-Poly1305 spec
const SECRETBOX_KEY_LEN = 32;
const SECRETBOX_NONCE_LEN = 24;

// ML-KEM-768 spec (NIST FIPS-203). publicKey=1184, secretKey=2400,
// cipherText=1088, sharedSecret=32.
const ML_KEM_CT_LEN = 1088;

// Hybrid blob format version. Bumped to 3+ for any future rotation.
const HYBRID_VERSION = 0x02;
const HYBRID_HEADER_LEN = 1 + ML_KEM_CT_LEN + SECRETBOX_NONCE_LEN;

// Domain separation for the combined-secret HKDF. Bumping these
// invalidates every stored wrap, so version alongside the blob
// byte — a future v3 coexists with v2 blobs during any migration.
const HYBRID_HKDF_SALT = utf8Encode("securewarp-hybrid-v2");
const HYBRID_HKDF_INFO = utf8Encode("securewarp-x25519-mlkem768-xchacha20-v2");

export interface EncryptedFile {
  encryptedContent: Uint8Array;
  nonce: string;      // base64
  sessionKey: string; // base64
}

export interface EncryptedMetadata {
  nonce: string;      // base64
  ciphertext: string; // base64
}

/**
 * Hybrid public-key pair: X25519 for classical ECDH, ML-KEM-768 for
 * PQ encapsulation. Every wrap target (user, file's hier keypair,
 * parent folder's hier keypair) exposes both.
 */
export interface HybridPublicKeys {
  x25519: string; // base64 — 32 bytes
  kem: string;    // base64 — 1184 bytes (ML-KEM-768)
}

/**
 * Matching private halves. `kem` is a full ML-KEM-768 secret key
 * (~2400 bytes).
 */
export interface HybridPrivateKeys {
  x25519: string; // base64 — 32 bytes
  kem: string;    // base64 — ~2400 bytes
}

export interface HierarchicalKeypair {
  publicKeys: HybridPublicKeys;
  privateKeys: HybridPrivateKeys;
}

// ──────────────────────────────────────────────────────────────────────
// Internal: hybrid wrap/unwrap primitives
// ──────────────────────────────────────────────────────────────────────

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function deriveHybridKey(xShared: Uint8Array, kemShared: Uint8Array): Uint8Array {
  const ikm = concatBytes(xShared, kemShared);
  try {
    return hkdf(sha256, ikm, HYBRID_HKDF_SALT, HYBRID_HKDF_INFO, SECRETBOX_KEY_LEN);
  } finally {
    ikm.fill(0);
  }
}

/**
 * Hybrid wrap: encapsulate `message` to the recipient's (X25519,
 * ML-KEM) public keys, authenticated by the sender's X25519 private
 * key. Returns a single self-contained base64 blob.
 */
function hybridWrap(
  message: Uint8Array,
  recipientXPubB64: string,
  recipientKemPubB64: string,
  senderXPrivB64: string,
): string {
  const recipientXPub = fromBase64(recipientXPubB64);
  const recipientKemPub = fromBase64(recipientKemPubB64);
  const senderXPriv = fromBase64(senderXPrivB64);

  const xShared = x25519.getSharedSecret(senderXPriv, recipientXPub);
  const { cipherText: kemCt, sharedSecret: kemShared } =
    ml_kem768.encapsulate(recipientKemPub);

  const key = deriveHybridKey(xShared, kemShared);
  try {
    const nonce = randomBytes(SECRETBOX_NONCE_LEN);
    const aeadCt = xchacha20poly1305(key, nonce).encrypt(message);
    return toBase64(
      concatBytes(new Uint8Array([HYBRID_VERSION]), kemCt, nonce, aeadCt),
    );
  } finally {
    xShared.fill(0);
    kemShared.fill(0);
    key.fill(0);
  }
}

function hybridUnwrap(
  blobB64: string,
  senderXPubB64: string,
  recipientXPrivB64: string,
  recipientKemPrivB64: string,
): Uint8Array {
  const blob = fromBase64(blobB64);
  if (blob.length < HYBRID_HEADER_LEN) {
    throw new Error("Hybrid unwrap failed — blob too short");
  }
  if (blob[0] !== HYBRID_VERSION) {
    throw new Error(`Hybrid unwrap failed — unsupported version ${blob[0]}`);
  }
  const kemCt = blob.slice(1, 1 + ML_KEM_CT_LEN);
  const nonce = blob.slice(1 + ML_KEM_CT_LEN, HYBRID_HEADER_LEN);
  const aeadCt = blob.slice(HYBRID_HEADER_LEN);

  const senderXPub = fromBase64(senderXPubB64);
  const recipientXPriv = fromBase64(recipientXPrivB64);
  const recipientKemPriv = fromBase64(recipientKemPrivB64);

  // X25519 is symmetric: (recipient_priv, sender_pub) yields the same
  // shared secret as (sender_priv, recipient_pub).
  const xShared = x25519.getSharedSecret(recipientXPriv, senderXPub);
  const kemShared = ml_kem768.decapsulate(kemCt, recipientKemPriv);

  const key = deriveHybridKey(xShared, kemShared);
  try {
    try {
      return xchacha20poly1305(key, nonce).decrypt(aeadCt);
    } catch {
      throw new Error("Hybrid unwrap failed — wrong key or tampered ciphertext");
    }
  } finally {
    xShared.fill(0);
    kemShared.fill(0);
    key.fill(0);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Symmetric helpers (unchanged from Phase 1)
// ──────────────────────────────────────────────────────────────────────

function secretboxSeal(plaintext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
  return xchacha20poly1305(key, nonce).encrypt(plaintext);
}

function secretboxOpen(ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
  // Noble throws "invalid tag" on AEAD failure. Callers wrap with their
  // own try/catch for stable user-facing messages.
  return xchacha20poly1305(key, nonce).decrypt(ciphertext);
}

export function generateSessionKey(): Uint8Array {
  return randomBytes(SECRETBOX_KEY_LEN);
}

export function encryptFileContent(content: Uint8Array, sessionKey: Uint8Array): {
  ciphertext: Uint8Array;
  nonce: string;
} {
  const nonce = randomBytes(SECRETBOX_NONCE_LEN);
  const ciphertext = secretboxSeal(content, nonce, sessionKey);
  return { ciphertext, nonce: toBase64(nonce) };
}

export function decryptFileContent(ciphertext: Uint8Array, nonceB64: string, sessionKey: Uint8Array): Uint8Array {
  const nonce = fromBase64(nonceB64);
  return secretboxOpen(ciphertext, nonce, sessionKey);
}

export function encryptMetadata(
  metadata: { name: string; type: string; size: number },
  sessionKey: Uint8Array,
): EncryptedMetadata {
  const payload = JSON.stringify(metadata);
  const nonce = randomBytes(SECRETBOX_NONCE_LEN);
  const messageBytes = new TextEncoder().encode(payload);
  const ciphertext = secretboxSeal(messageBytes, nonce, sessionKey);
  return { nonce: toBase64(nonce), ciphertext: toBase64(ciphertext) };
}

export function decryptMetadata(
  encrypted: EncryptedMetadata,
  sessionKey: Uint8Array,
): { name: string; type: string; size: number } {
  const nonce = fromBase64(encrypted.nonce);
  const ciphertext = fromBase64(encrypted.ciphertext);
  const plaintext = secretboxOpen(ciphertext, nonce, sessionKey);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

// ──────────────────────────────────────────────────────────────────────
// Hierarchical keypair (hybrid)
// ──────────────────────────────────────────────────────────────────────

/**
 * Generate a fresh hybrid (X25519 + ML-KEM-768) hierarchical keypair
 * for a file. The two halves are independent — compromising one
 * doesn't reveal the other.
 */
export function generateHierarchicalKeypair(): HierarchicalKeypair {
  const xPriv = x25519.utils.randomSecretKey();
  const xPub = x25519.getPublicKey(xPriv);
  const kemKp = ml_kem768.keygen();
  return {
    publicKeys: {
      x25519: toBase64(xPub),
      kem: toBase64(kemKp.publicKey),
    },
    privateKeys: {
      x25519: toBase64(xPriv),
      kem: toBase64(kemKp.secretKey),
    },
  };
}

/**
 * Serialize a hybrid private-key bundle as JSON bytes. Used for the
 * payload wrapped into file_keys / parent_keys_claim / link rows.
 */
function serializeHybridPrivate(priv: HybridPrivateKeys): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(priv));
}

function deserializeHybridPrivate(bytes: Uint8Array): HybridPrivateKeys {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as HybridPrivateKeys;
  if (typeof parsed.x25519 !== "string" || typeof parsed.kem !== "string") {
    throw new Error("Invalid hybrid-private payload");
  }
  return parsed;
}

// ──────────────────────────────────────────────────────────────────────
// Session key → file's hybrid pub hier keys
// ──────────────────────────────────────────────────────────────────────

/**
 * Wrap the file's session key to its own hybrid public hierarchical
 * keys. The owner is the X25519 ECDH sender. Returns a single blob;
 * `sessionKeyNonce` is an empty string placeholder in v2 (kept on
 * the DB row for back-compat; a later migration drops it).
 */
export function wrapSessionKeyToFile(
  sessionKey: Uint8Array,
  filePubHier: HybridPublicKeys,
  ownerXPriv: string,
): { encryptedSessionKeyByFile: string; sessionKeyNonce: string } {
  const blob = hybridWrap(sessionKey, filePubHier.x25519, filePubHier.kem, ownerXPriv);
  return { encryptedSessionKeyByFile: blob, sessionKeyNonce: "" };
}

export function unwrapSessionKeyFromFile(
  encryptedSessionKeyByFile: string,
  _sessionKeyNonce: string, // unused in v2; kept in signature for caller ergonomics
  ownerXPub: string,
  filePrivHier: HybridPrivateKeys,
): Uint8Array {
  return hybridUnwrap(
    encryptedSessionKeyByFile,
    ownerXPub,
    filePrivHier.x25519,
    filePrivHier.kem,
  );
}

// ──────────────────────────────────────────────────────────────────────
// Private hier → collaborator (the file_keys row payload)
// ──────────────────────────────────────────────────────────────────────

export function wrapPrivateHierarchicalKeyForUser(
  filePrivHier: HybridPrivateKeys,
  recipientPubUser: HybridPublicKeys,
  sharerXPriv: string,
): string {
  const payload = serializeHybridPrivate(filePrivHier);
  try {
    return hybridWrap(payload, recipientPubUser.x25519, recipientPubUser.kem, sharerXPriv);
  } finally {
    payload.fill(0);
  }
}

export function unwrapPrivateHierarchicalKey(
  encryptedPrivateHier: string,
  wrappedByXPub: string,
  recipientXPriv: string,
  recipientKemPriv: string,
): HybridPrivateKeys {
  const bytes = hybridUnwrap(
    encryptedPrivateHier,
    wrappedByXPub,
    recipientXPriv,
    recipientKemPriv,
  );
  try {
    return deserializeHybridPrivate(bytes);
  } finally {
    bytes.fill(0);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Link sharing (symmetric wrap over the hybrid priv bundle)
// ──────────────────────────────────────────────────────────────────────

export function generateLinkKey(): Uint8Array {
  return randomBytes(SECRETBOX_KEY_LEN);
}

export function wrapPrivateHierarchicalKeyForLink(
  privHier: HybridPrivateKeys,
  linkKey: Uint8Array,
): { encryptedPrivateHierarchicalKey: string; linkKeyNonce: string } {
  const payload = serializeHybridPrivate(privHier);
  try {
    const nonce = randomBytes(SECRETBOX_NONCE_LEN);
    const ciphertext = secretboxSeal(payload, nonce, linkKey);
    return {
      encryptedPrivateHierarchicalKey: toBase64(ciphertext),
      linkKeyNonce: toBase64(nonce),
    };
  } finally {
    payload.fill(0);
  }
}

export function unwrapPrivateHierarchicalKeyFromLink(
  encryptedPrivateHier: string,
  linkKeyNonce: string,
  linkKey: Uint8Array,
): HybridPrivateKeys {
  let plain: Uint8Array;
  try {
    plain = secretboxOpen(
      fromBase64(encryptedPrivateHier),
      fromBase64(linkKeyNonce),
      linkKey,
    );
  } catch {
    throw new Error("Link unwrap failed — wrong key or tampered ciphertext");
  }
  try {
    return deserializeHybridPrivate(plain);
  } finally {
    plain.fill(0);
  }
}

export function encodeLinkKeyForFragment(linkKey: Uint8Array): string {
  return toBase64(linkKey).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeLinkKeyFromFragment(fragment: string): Uint8Array {
  const padded = fragment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return fromBase64(padded + pad);
}

// ──────────────────────────────────────────────────────────────────────
// Password-protected links (Phase 4.1, symmetric — unchanged by v2)
// ──────────────────────────────────────────────────────────────────────

const LINK_ARGON2_MEMORY_KB = 32 * 1024;
const LINK_ARGON2_ITERATIONS = 2;
const LINK_ARGON2_PARALLELISM = 1;
const LINK_KEY_LENGTH = SECRETBOX_KEY_LEN;

export function deriveLinkWrappingKey(password: string, salt: Uint8Array): Uint8Array {
  return argon2id(password, salt, {
    t: LINK_ARGON2_ITERATIONS,
    m: LINK_ARGON2_MEMORY_KB,
    p: LINK_ARGON2_PARALLELISM,
    dkLen: LINK_KEY_LENGTH,
  });
}

export function wrapLinkKeyWithPassword(
  linkKey: Uint8Array,
  password: string,
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

export function unwrapLinkKeyWithPassword(
  passwordWrappedLinkKey: string,
  passwordSalt: string,
  passwordWrapNonce: string,
  password: string,
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
// Parent keys claim (folder inheritance, hybrid in v2)
// ──────────────────────────────────────────────────────────────────────

interface ParentClaimPayload {
  sessionKey: string;                            // base64
  childPrivateHierarchicalKeys: HybridPrivateKeys;
}

export function wrapParentKeysClaim(
  sessionKey: Uint8Array,
  childPrivHier: HybridPrivateKeys,
  parentPubHier: HybridPublicKeys,
  ownerXPriv: string,
): string {
  const payload: ParentClaimPayload = {
    sessionKey: toBase64(sessionKey),
    childPrivateHierarchicalKeys: childPrivHier,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  try {
    return hybridWrap(bytes, parentPubHier.x25519, parentPubHier.kem, ownerXPriv);
  } finally {
    bytes.fill(0);
  }
}

export function unwrapParentKeysClaim(
  parentKeysClaim: string,
  wrappedByXPub: string,
  parentPrivHier: HybridPrivateKeys,
): { sessionKey: Uint8Array; childPrivateHierarchicalKeys: HybridPrivateKeys } {
  const bytes = hybridUnwrap(
    parentKeysClaim,
    wrappedByXPub,
    parentPrivHier.x25519,
    parentPrivHier.kem,
  );
  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as ParentClaimPayload;
    return {
      sessionKey: fromBase64(payload.sessionKey),
      childPrivateHierarchicalKeys: payload.childPrivateHierarchicalKeys,
    };
  } finally {
    bytes.fill(0);
  }
}
