/**
 * Key generation and user data encryption.
 *
 * Crypto v2 Phase 2a (2026-04-21):
 *   - Users now carry BOTH an X25519 encryption keypair (classical,
 *     used by every current wrap) AND an ML-KEM-768 keypair (post-
 *     quantum, DORMANT in 2a — generated + stored but nothing wraps
 *     with it yet). The hybrid wrap paths that actually combine the
 *     two arrive in Phase 2b (file session keys), 2c (file_keys
 *     grants), and 2d (link sharing). Keeping the ML-KEM key dormant
 *     for one release de-risks the migration: accounts created now
 *     already carry the PQ half, so when 2b-2d flip to hybrid wraps
 *     there's no schema-vs-code race.
 *
 *   - XChaCha20-Poly1305 still seals the private-keys-at-rest blob;
 *     the serialized payload grows to include `kemPrivateKey`
 *     alongside `encryptionPrivateKey`.
 *
 *   - No signing keypair (dropped in v2 Phase 1; see
 *     project_signed_share_invites memo for the planned rebuild).
 *
 * Recovery uses HKDF to split the BIP39 entropy into a verification
 * key (what the server stores) and an encryption key (what actually
 * decrypts the backup blob) so a compromised server can't derive the
 * encryption key from the hash alone.
 */

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { generateMnemonic, mnemonicToEntropy } from "bip39";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { toBase64, fromBase64, randomBytes, fromHex } from "./utils";

const SECRETBOX_NONCE_LEN = 24;

/**
 * Hybrid per-user keypair bundle. Each algorithm has its own pub +
 * priv. `encryptionPublicKey` / `encryptionPrivateKey` keep their
 * legacy names for the X25519 half so call sites that already speak
 * that vocabulary stay compact; the new `kemPublicKey` /
 * `kemPrivateKey` carry ML-KEM-768 material.
 *
 * In Phase 2a the KEM fields are generated + persisted but NOT used
 * for wrapping. They become live in Phase 2b onward.
 */
export interface UserKeypairs {
  encryptionPublicKey: string;   // base64 — X25519 (32 bytes)
  encryptionPrivateKey: string;  // base64 — X25519 (32 bytes)
  kemPublicKey: string;          // base64 — ML-KEM-768 (1184 bytes)
  kemPrivateKey: string;         // base64 — ML-KEM-768 (~2400 bytes)
}

export interface EncryptedUserData {
  nonce: string;      // base64
  ciphertext: string; // base64
}

/**
 * Generate a fresh hybrid (X25519 + ML-KEM-768) encryption keypair.
 * The two halves are independent — compromising one doesn't leak
 * the other.
 */
export function generateKeypairs(): UserKeypairs {
  const xPriv = x25519.utils.randomSecretKey();
  const xPub = x25519.getPublicKey(xPriv);
  const kemKp = ml_kem768.keygen();

  return {
    encryptionPublicKey: toBase64(xPub),
    encryptionPrivateKey: toBase64(xPriv),
    kemPublicKey: toBase64(kemKp.publicKey),
    kemPrivateKey: toBase64(kemKp.secretKey),
  };
}

/**
 * Encrypt private keys (both halves) with the password-derived
 * secret using XChaCha20-Poly1305. The server stores the resulting
 * ciphertext as `users.encrypted_user_data`.
 *
 * Payload JSON carries BOTH privates. A v1 blob (with only
 * `encryptionPrivateKey`) decrypts cleanly; `kemPrivateKey` would
 * come back undefined. We treat that as a legacy state in v2b+
 * callers and regenerate the KEM keypair on next login — but every
 * crypto-v2 account created from 2a onward writes both from the
 * start, so the legacy path should never fire in practice.
 */
export function encryptUserData(
  keypairs: UserKeypairs,
  passwordDerivedSecret: Uint8Array,
): EncryptedUserData {
  const payload = JSON.stringify({
    encryptionPrivateKey: keypairs.encryptionPrivateKey,
    kemPrivateKey: keypairs.kemPrivateKey,
  });

  const nonce = randomBytes(SECRETBOX_NONCE_LEN);
  const messageBytes = new TextEncoder().encode(payload);
  const ciphertext = xchacha20poly1305(passwordDerivedSecret, nonce).encrypt(messageBytes);

  return {
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
  };
}

export interface DecryptedUserData {
  encryptionPrivateKey: string;
  kemPrivateKey: string;
}

export function decryptUserData(
  encrypted: EncryptedUserData,
  passwordDerivedSecret: Uint8Array,
): DecryptedUserData {
  const nonce = fromBase64(encrypted.nonce);
  const ciphertext = fromBase64(encrypted.ciphertext);
  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(passwordDerivedSecret, nonce).decrypt(ciphertext);
  } catch {
    throw new Error("Decryption failed — wrong password or corrupted data");
  }

  const payload = JSON.parse(new TextDecoder().decode(plaintext));
  if (typeof payload.encryptionPrivateKey !== "string") {
    throw new Error("Decryption failed — invalid user-data payload shape");
  }
  return {
    encryptionPrivateKey: payload.encryptionPrivateKey,
    // Older v1 blobs didn't store the KEM private; tolerate an
    // empty value here so change-password / recover paths don't
    // crash on pre-2a accounts. Should never actually fire after
    // the 2a wipe + re-register.
    kemPrivateKey: typeof payload.kemPrivateKey === "string" ? payload.kemPrivateKey : "",
  };
}

/* ═══════ RECOVERY KEY — uses HKDF to split verification from encryption ═══════ */

export function generateRecoveryKey(): string {
  return generateMnemonic(256);
}

function deriveRecoveryKeys(recoveryKey: string): {
  verificationKey: Uint8Array;
  encryptionKey: Uint8Array;
} {
  const entropy = fromHex(mnemonicToEntropy(recoveryKey));
  const enc = new TextEncoder();
  const salt = enc.encode("securewarp-recovery-v2");
  const verificationKey = hkdf(sha256, entropy, salt, enc.encode("securewarp-recovery-verify-v2"), 32);
  const encryptionKey = hkdf(sha256, entropy, salt, enc.encode("securewarp-recovery-encrypt-v2"), 32);
  return { verificationKey, encryptionKey };
}

export function encryptWithRecoveryKey(
  keypairs: UserKeypairs,
  recoveryKey: string,
): EncryptedUserData {
  const { encryptionKey } = deriveRecoveryKeys(recoveryKey);
  return encryptUserData(keypairs, encryptionKey);
}

export function decryptWithRecoveryKey(
  encrypted: EncryptedUserData,
  recoveryKey: string,
): DecryptedUserData {
  const { encryptionKey } = deriveRecoveryKeys(recoveryKey);
  return decryptUserData(encrypted, encryptionKey);
}

export async function hashRecoveryKey(recoveryKey: string): Promise<string> {
  const { verificationKey } = deriveRecoveryKeys(recoveryKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", new Uint8Array(verificationKey) as unknown as ArrayBuffer);
  const hashArray = new Uint8Array(hashBuffer);
  return toBase64(hashArray);
}
