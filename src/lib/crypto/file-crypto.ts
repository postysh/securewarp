/**
 * File encryption — client-side only.
 *
 * Phase 2 hierarchical key model (Skiff-style):
 *   - Every file has a random symmetric `sessionKey` for content + metadata.
 *   - Every file has an asymmetric `hierarchicalKeyPair` (nacl.box).
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

import nacl from "tweetnacl";
import { toBase64, fromBase64, randomBytes } from "./utils";

export interface EncryptedFile {
  encryptedContent: Uint8Array;  // raw ciphertext to upload to R2
  nonce: string;                 // base64
  sessionKey: string;            // base64 — the raw session key (encrypt this per-user)
}

export interface EncryptedMetadata {
  nonce: string;      // base64
  ciphertext: string; // base64
}

/**
 * Generate a random session key for a file.
 */
export function generateSessionKey(): Uint8Array {
  return randomBytes(nacl.secretbox.keyLength);
}

/**
 * Encrypt file content with a session key.
 */
export function encryptFileContent(content: Uint8Array, sessionKey: Uint8Array): {
  ciphertext: Uint8Array;
  nonce: string;
} {
  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(content, nonce, sessionKey);

  if (!ciphertext) throw new Error("File encryption failed");

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
  const plaintext = nacl.secretbox.open(ciphertext, nonce, sessionKey);

  if (!plaintext) throw new Error("File decryption failed — wrong key or corrupted data");

  return plaintext;
}

/**
 * Encrypt file metadata (name, type, size) with the session key.
 */
export function encryptMetadata(
  metadata: { name: string; type: string; size: number },
  sessionKey: Uint8Array
): EncryptedMetadata {
  const payload = JSON.stringify(metadata);
  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const messageBytes = new TextEncoder().encode(payload);
  const ciphertext = nacl.secretbox(messageBytes, nonce, sessionKey);

  if (!ciphertext) throw new Error("Metadata encryption failed");

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
  const plaintext = nacl.secretbox.open(ciphertext, nonce, sessionKey);

  if (!plaintext) throw new Error("Metadata decryption failed");

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
 * Generate a fresh Curve25519 keypair for use as a file's hierarchical key.
 * Nothing distinguishes these from a user's own encryption keypair at the
 * crypto layer — only the role they play in the storage model differs.
 */
export function generateHierarchicalKeypair(): HierarchicalKeypair {
  const kp = nacl.box.keyPair();
  return {
    publicKey: toBase64(kp.publicKey),
    privateKey: toBase64(kp.secretKey),
  };
}

// Shared nacl.box wrap helper. Returns combined nonce‖ciphertext base64 plus
// the nonce separately (for cases where the storage schema splits them).
function boxWrap(
  message: Uint8Array,
  recipientPublicKey: string,
  senderPrivateKey: string
): { combined: string; nonceB64: string; ciphertextB64: string } {
  const pubKey = fromBase64(recipientPublicKey);
  const privKey = fromBase64(senderPrivateKey);
  const nonce = randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(message, nonce, pubKey, privKey);
  if (!ciphertext) throw new Error("Box encryption failed");

  const combined = new Uint8Array(nonce.length + ciphertext.length);
  combined.set(nonce);
  combined.set(ciphertext, nonce.length);
  return {
    combined: toBase64(combined),
    nonceB64: toBase64(nonce),
    ciphertextB64: toBase64(ciphertext),
  };
}

function boxOpenCombined(
  combinedB64: string,
  senderPublicKey: string,
  recipientPrivateKey: string
): Uint8Array {
  const combined = fromBase64(combinedB64);
  const nonce = combined.slice(0, nacl.box.nonceLength);
  const ciphertext = combined.slice(nacl.box.nonceLength);
  const plain = nacl.box.open(
    ciphertext,
    nonce,
    fromBase64(senderPublicKey),
    fromBase64(recipientPrivateKey)
  );
  if (!plain) throw new Error("Box decryption failed — wrong key or tampered ciphertext");
  return plain;
}

function boxOpenSplit(
  ciphertextB64: string,
  nonceB64: string,
  senderPublicKey: string,
  recipientPrivateKey: string
): Uint8Array {
  const plain = nacl.box.open(
    fromBase64(ciphertextB64),
    fromBase64(nonceB64),
    fromBase64(senderPublicKey),
    fromBase64(recipientPrivateKey)
  );
  if (!plain) throw new Error("Box decryption failed — wrong key or tampered ciphertext");
  return plain;
}

/**
 * Wrap a file's session key to its own public hierarchical key. The owner
 * is always the box sender — their public key is what a reader uses to
 * unwrap via nacl.box.open. Returns `ciphertext` + `nonce` as separate
 * base64 strings so the DB schema can store them in distinct columns.
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
 * must use when unwrapping via nacl.box.open.
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
  return randomBytes(nacl.secretbox.keyLength);
}

/**
 * Wrap a file's private hierarchical key under a link's symmetric key.
 * Uses `nacl.secretbox` so no sender public key is involved — anyone
 * who holds `linkKey` can unwrap. `linkKey` lives only in the URL fragment
 * and is never transmitted to the server.
 */
export function wrapPrivateHierarchicalKeyForLink(
  privateHierarchicalKey: string, // base64
  linkKey: Uint8Array
): { encryptedPrivateHierarchicalKey: string; linkKeyNonce: string } {
  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(fromBase64(privateHierarchicalKey), nonce, linkKey);
  if (!ciphertext) throw new Error("Link wrap failed");
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
  const plain = nacl.secretbox.open(
    fromBase64(encryptedPrivateHierarchicalKey),
    fromBase64(linkKeyNonce),
    linkKey
  );
  if (!plain) throw new Error("Link unwrap failed — wrong key or tampered ciphertext");
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
 * nacl.box sender. The result is a single base64 combined nonce‖ciphertext.
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
