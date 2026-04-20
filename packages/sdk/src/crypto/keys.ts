/**
 * Key generation and user data encryption.
 *
 * - Curve25519 keypair for asymmetric encryption (file key exchange)
 * - Ed25519 keypair for digital signatures (proving authenticity)
 * - secretbox for encrypting private keys with password-derived secret
 * - Recovery key uses HKDF to derive separate verification and encryption keys
 */

import nacl from "tweetnacl";
import { generateMnemonic, mnemonicToEntropy } from "bip39";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { toBase64, fromBase64, randomBytes, fromHex } from "./utils";

export interface UserKeypairs {
  encryptionPublicKey: string;   // base64
  encryptionPrivateKey: string;  // base64
  signingPublicKey: string;      // base64
  signingPrivateKey: string;     // base64
}

export interface EncryptedUserData {
  nonce: string;      // base64
  ciphertext: string; // base64
}

/**
 * Generate fresh Curve25519 (encryption) and Ed25519 (signing) keypairs.
 */
export function generateKeypairs(): UserKeypairs {
  const encKp = nacl.box.keyPair();
  const sigKp = nacl.sign.keyPair();

  return {
    encryptionPublicKey: toBase64(encKp.publicKey),
    encryptionPrivateKey: toBase64(encKp.secretKey),
    signingPublicKey: toBase64(sigKp.publicKey),
    signingPrivateKey: toBase64(sigKp.secretKey),
  };
}

/**
 * Encrypt private keys with the password-derived secret using xsalsa20-poly1305.
 */
export function encryptUserData(
  keypairs: UserKeypairs,
  passwordDerivedSecret: Uint8Array
): EncryptedUserData {
  const payload = JSON.stringify({
    encryptionPrivateKey: keypairs.encryptionPrivateKey,
    signingPrivateKey: keypairs.signingPrivateKey,
  });

  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const messageBytes = new TextEncoder().encode(payload);
  const ciphertext = nacl.secretbox(messageBytes, nonce, passwordDerivedSecret);

  if (!ciphertext) {
    throw new Error("Encryption failed");
  }

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
): { encryptionPrivateKey: string; signingPrivateKey: string } {
  const nonce = fromBase64(encrypted.nonce);
  const ciphertext = fromBase64(encrypted.ciphertext);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, passwordDerivedSecret);

  if (!plaintext) {
    throw new Error("Decryption failed — wrong password or corrupted data");
  }

  const payload = JSON.parse(new TextDecoder().decode(plaintext));
  return {
    encryptionPrivateKey: payload.encryptionPrivateKey,
    signingPrivateKey: payload.signingPrivateKey,
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
  const salt = enc.encode("securewarp-recovery-v1");
  const verificationKey = hkdf(sha256, entropy, salt, enc.encode("securewarp-recovery-verify-v1"), 32);
  const encryptionKey = hkdf(sha256, entropy, salt, enc.encode("securewarp-recovery-encrypt-v1"), 32);
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
): { encryptionPrivateKey: string; signingPrivateKey: string } {
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
