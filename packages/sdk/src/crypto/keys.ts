/**
 * Key generation and user data encryption.
 *
 * Crypto v2 (2026-04-20):
 *   - X25519 encryption keypair via `@noble/curves` (replaces
 *     `nacl.box.keyPair()`). Used by the asymmetric wrap layer in
 *     file-crypto.ts to grant file access to collaborators.
 *   - XChaCha20-Poly1305 for the private-key-at-rest encryption
 *     (replaces `nacl.secretbox`). Same 32-byte key + 24-byte nonce
 *     shape; only the AEAD primitive rotated.
 *   - No signing keypair. We used to generate Ed25519 alongside
 *     X25519, but nothing ever signed or verified anything with it —
 *     it was dormant crypto state. Removed to reduce surface area.
 *     Signed share invites are tracked as a deferred roadmap item;
 *     when we build them, we'll add Ed25519 back paired with actual
 *     verification code.
 *
 * Recovery uses HKDF to split the BIP39 entropy into a verification
 * key (what the server stores) and an encryption key (what actually
 * decrypts the backup blob) so a compromised server can't derive the
 * encryption key from the hash alone.
 */

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { generateMnemonic, mnemonicToEntropy } from "bip39";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { toBase64, fromBase64, randomBytes, fromHex } from "./utils";

const SECRETBOX_KEY_LEN = 32;
const SECRETBOX_NONCE_LEN = 24;

export interface UserKeypairs {
  encryptionPublicKey: string;   // base64
  encryptionPrivateKey: string;  // base64
}

export interface EncryptedUserData {
  nonce: string;      // base64
  ciphertext: string; // base64
}

/**
 * Generate a fresh X25519 encryption keypair.
 */
export function generateKeypairs(): UserKeypairs {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);

  return {
    encryptionPublicKey: toBase64(publicKey),
    encryptionPrivateKey: toBase64(privateKey),
  };
}

/**
 * Encrypt private keys with the password-derived secret using XChaCha20-Poly1305.
 */
export function encryptUserData(
  keypairs: UserKeypairs,
  passwordDerivedSecret: Uint8Array
): EncryptedUserData {
  const payload = JSON.stringify({
    encryptionPrivateKey: keypairs.encryptionPrivateKey,
  });

  const nonce = randomBytes(SECRETBOX_NONCE_LEN);
  const messageBytes = new TextEncoder().encode(payload);
  const ciphertext = xchacha20poly1305(passwordDerivedSecret, nonce).encrypt(messageBytes);

  return {
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
  };
}

/**
 * Decrypt private keys with the password-derived secret.
 */
export function decryptUserData(
  encrypted: EncryptedUserData,
  passwordDerivedSecret: Uint8Array
): { encryptionPrivateKey: string } {
  const nonce = fromBase64(encrypted.nonce);
  const ciphertext = fromBase64(encrypted.ciphertext);
  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(passwordDerivedSecret, nonce).decrypt(ciphertext);
  } catch {
    throw new Error("Decryption failed — wrong password or corrupted data");
  }

  const payload = JSON.parse(new TextDecoder().decode(plaintext));
  return {
    encryptionPrivateKey: payload.encryptionPrivateKey,
  };
}

/* ═══════ RECOVERY KEY — uses HKDF to split verification from encryption ═══════ */

/**
 * Generate a recovery key as a 24-word BIP39 mnemonic.
 * 256 bits of entropy = 24 words.
 */
export function generateRecoveryKey(): string {
  return generateMnemonic(256);
}

/**
 * Derive separate verification and encryption keys from the mnemonic entropy.
 * This ensures the hash stored on the server cannot be used to derive the encryption key.
 */
function deriveRecoveryKeys(recoveryKey: string): {
  verificationKey: Uint8Array;
  encryptionKey: Uint8Array;
} {
  const entropy = fromHex(mnemonicToEntropy(recoveryKey));
  const enc = new TextEncoder();
  // Fixed, non-secret salt provides HKDF domain separation per RFC 5869.
  // Versioned so future algorithm changes can coexist with old recovery keys.
  const salt = enc.encode("securewarp-recovery-v2");
  const verificationKey = hkdf(sha256, entropy, salt, enc.encode("securewarp-recovery-verify-v2"), 32);
  const encryptionKey = hkdf(sha256, entropy, salt, enc.encode("securewarp-recovery-encrypt-v2"), 32);
  return { verificationKey, encryptionKey };
}

/**
 * Encrypt private keys with the recovery encryption key.
 */
export function encryptWithRecoveryKey(
  keypairs: UserKeypairs,
  recoveryKey: string
): EncryptedUserData {
  const { encryptionKey } = deriveRecoveryKeys(recoveryKey);
  return encryptUserData(keypairs, encryptionKey);
}

/**
 * Decrypt private keys with the recovery encryption key.
 */
export function decryptWithRecoveryKey(
  encrypted: EncryptedUserData,
  recoveryKey: string
): { encryptionPrivateKey: string } {
  const { encryptionKey } = deriveRecoveryKeys(recoveryKey);
  return decryptUserData(encrypted, encryptionKey);
}

/**
 * Hash the recovery key's verification key for server-side storage.
 * Uses the HKDF-derived verification key, NOT the raw entropy.
 */
export async function hashRecoveryKey(recoveryKey: string): Promise<string> {
  const { verificationKey } = deriveRecoveryKeys(recoveryKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", new Uint8Array(verificationKey) as unknown as ArrayBuffer);
  const hashArray = new Uint8Array(hashBuffer);
  return toBase64(hashArray);
}

// Reference unused constants so strict-mode TypeScript doesn't flag the
// exported-but-unreferenced guard. SECRETBOX_KEY_LEN documents the key
// size every caller expects.
void SECRETBOX_KEY_LEN;
