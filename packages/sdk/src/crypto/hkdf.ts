/**
 * HKDF key splitting — derives purpose-specific keys from a single master key.
 *
 * masterKey → HKDF-SHA256 → srpKey (SRP-6a authentication)
 *                          → passwordDerivedSecret (encrypts server-stored
 *                            private-key blob; decrypts user data on login)
 *                          → unlockCacheKey (encrypts the LOCAL lock cache
 *                            blob in localStorage; unwrapped on tab reopen
 *                            via a password re-entry, without a server
 *                            round-trip)
 *
 * All keys are derived from the same master key via different HKDF info
 * strings, so knowing any one leaks nothing about the others. Each has
 * its own `-v2` versioning suffix (bumped from `-v1` in crypto v2,
 * 2026-04-20) so future algorithm changes can coexist with existing
 * data.
 */

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8Encode } from "./utils";

const HKDF_SALT = utf8Encode("securewarp-hkdf-v2");
const SRP_KEY_INFO = "securewarp-srp-key-v2";
const PDS_INFO = "securewarp-password-derived-secret-v2";
const UNLOCK_CACHE_INFO = "securewarp-unlock-cache-v2";
const KEY_LENGTH = 32;

export function splitMasterKey(masterKey: Uint8Array): {
  srpKey: Uint8Array;
  passwordDerivedSecret: Uint8Array;
  unlockCacheKey: Uint8Array;
} {
  const srpKey = hkdf(sha256, masterKey, HKDF_SALT, utf8Encode(SRP_KEY_INFO), KEY_LENGTH);
  const passwordDerivedSecret = hkdf(sha256, masterKey, HKDF_SALT, utf8Encode(PDS_INFO), KEY_LENGTH);
  const unlockCacheKey = hkdf(sha256, masterKey, HKDF_SALT, utf8Encode(UNLOCK_CACHE_INFO), KEY_LENGTH);

  return { srpKey, passwordDerivedSecret, unlockCacheKey };
}
