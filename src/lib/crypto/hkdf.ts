/**
 * HKDF key splitting — derives two purpose-specific keys from a single master key.
 *
 * masterKey → HKDF-SHA256 → srpKey (for SRP authentication)
 *                          → passwordDerivedSecret (for encrypting private keys)
 */

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8Encode } from "./utils";

const HKDF_SALT = utf8Encode("securewarp-hkdf-v1");
const SRP_KEY_INFO = "securewarp-srp-key";
const PDS_INFO = "securewarp-password-derived-secret";
const KEY_LENGTH = 32;

export function splitMasterKey(masterKey: Uint8Array): {
  srpKey: Uint8Array;
  passwordDerivedSecret: Uint8Array;
} {
  const srpKey = hkdf(sha256, masterKey, HKDF_SALT, utf8Encode(SRP_KEY_INFO), KEY_LENGTH);
  const passwordDerivedSecret = hkdf(sha256, masterKey, HKDF_SALT, utf8Encode(PDS_INFO), KEY_LENGTH);

  return { srpKey, passwordDerivedSecret };
}
