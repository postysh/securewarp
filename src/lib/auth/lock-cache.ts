/**
 * Local "lock cache" — persistent, password-unlockable snapshot of the
 * user's decrypted private keys.
 *
 * Problem this solves: `sessionStorage` is per-tab and wiped when the
 * tab closes, but the 7-day JWT auth cookie isn't. Without a cache,
 * closing the browser and returning later means the server still
 * trusts you, but the client has no key material — files can't
 * decrypt, sidebar can't render your email, the app is a zombie.
 * Prior to this module, `drive-client.tsx` redirected to the full
 * login flow in that state, forcing a complete SRP handshake on every
 * tab reopen.
 *
 * How it works:
 *   - On successful login/signup/recover, we run the existing Argon2id
 *     master-key derivation to get `masterKey`, then HKDF-split to
 *     get `unlockCacheKey` (new third output added in `hkdf.ts`).
 *   - We `nacl.secretbox` the four private key strings (encryption +
 *     signing, public + private each) under `unlockCacheKey`.
 *   - The ciphertext plus the user's email and the `argon2Salt`
 *     originally pulled from the server during login go into
 *     `localStorage` as a single JSON blob.
 *   - On tab reopen, `auth-screen.tsx` detects the blob, prompts for
 *     ONLY the password (no email, no SRP, no server round-trip),
 *     re-runs local Argon2id + HKDF to recover `unlockCacheKey`,
 *     and unseals the ciphertext. Keys land back in sessionStorage.
 *
 * Why this preserves zero-knowledge:
 *   - The server never learns `unlockCacheKey`. It's derived entirely
 *     client-side from the password.
 *   - An attacker with the device's disk has a ciphertext and a salt
 *     but no password — same brute-force cost as the SRP-stored
 *     verifier protects against.
 *   - An attacker with XSS execution can dump the blob, but it's still
 *     useless without the password. The in-memory `unlockCacheKey` is
 *     zeroed after unsealing.
 *
 * Lifecycle:
 *   - Login/signup/recover → `saveLockCache` after deriving keys.
 *   - Tab reopen → `readLockCacheMeta` checks presence, `unlockKeys`
 *     performs the actual unwrap.
 *   - Explicit logout → `clearLockCache` MUST be called alongside
 *     sessionStorage wipe, otherwise the next visit silently unlocks.
 *   - Password change / recovery → `clearLockCache` first, then the
 *     new flow writes a fresh blob with the new-password-derived key.
 */

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import {
  toBase64,
  fromBase64,
  randomBytes,
} from "@/lib/crypto/utils";

// Crypto v2 bump: the old `_v1` blob was sealed with xsalsa20-poly1305
// under HKDF `-v1` info strings. Neither the old blob nor the old key
// derivation is compatible with v2 — any returning user with a v1 blob
// falls through to the full login path (same graceful degradation as
// if they'd never had a cache), which re-registers a fresh v2 blob on
// next login.
const STORAGE_KEY = "securewarp_lock_cache_v2";
const SECRETBOX_NONCE_LEN = 24;

// What we persist. `email` and `argon2Salt` live alongside the blob
// in plaintext because neither is a secret — the salt is the same one
// the server sends during login/init, and the email is visible on the
// unlock screen anyway ("Unlock as alice@example.com"). Keeping them
// locally lets unlock run without a server round-trip.
interface LockCacheBlob {
  email: string;
  argon2Salt: string; // base64 — same one used to derive masterKey on login
  ciphertext: string; // base64 — secretbox of the four key strings
  nonce: string;      // base64
  version: number;    // future-proof for wrap format changes
}

interface UnsealedKeyPayload {
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
}

// NOTE: `searchIndexKey` (HKDF output for search-token HMAC) is NOT
// cached here. It's deterministic from the master key, and the unlock
// flow already re-derives the master key, so the caller can recompute
// it for free. Caching it would just enlarge the on-disk blob.

const CURRENT_VERSION = 1;

/**
 * Seal the user's four key strings under `unlockCacheKey` and persist
 * to `localStorage`. Caller is responsible for zeroing `unlockCacheKey`
 * after this returns.
 */
export function saveLockCache(params: {
  email: string;
  argon2Salt: string;
  keys: UnsealedKeyPayload;
  unlockCacheKey: Uint8Array;
}): void {
  if (typeof window === "undefined") return;
  const plaintext = new TextEncoder().encode(JSON.stringify(params.keys));
  const nonce = randomBytes(SECRETBOX_NONCE_LEN);
  const ciphertext = xchacha20poly1305(params.unlockCacheKey, nonce).encrypt(plaintext);

  const blob: LockCacheBlob = {
    email: params.email,
    argon2Salt: params.argon2Salt,
    ciphertext: toBase64(ciphertext),
    nonce: toBase64(nonce),
    version: CURRENT_VERSION,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // Quota full, storage disabled (Safari Private Browsing), etc.
    // Fail silently — the caller falls back to full login on next
    // reopen, which is the pre-unlock-cache behaviour.
  }
}

export interface LockCacheMeta {
  email: string;
  argon2Salt: string;
}

/**
 * Read the non-secret metadata (email + argon2 salt) from the stored
 * blob, or `null` if no cache exists. Used by the unlock screen to
 * pre-fill the email field before the user types their password.
 */
export function readLockCacheMeta(): LockCacheMeta | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const blob = JSON.parse(raw) as LockCacheBlob;
    if (blob.version !== CURRENT_VERSION) return null;
    return { email: blob.email, argon2Salt: blob.argon2Salt };
  } catch {
    return null;
  }
}

/**
 * Attempt to unseal the cached key payload with a caller-supplied
 * `unlockCacheKey` (already derived from the password + argon2Salt
 * via the hook). Returns the four key strings on success, throws on
 * wrong password / tampered ciphertext / missing blob.
 *
 * The caller MUST zero `unlockCacheKey` after this returns regardless
 * of outcome — it's a sibling of the login path's `passwordDerivedSecret`
 * and deserves the same hygiene.
 */
export function unlockKeys(unlockCacheKey: Uint8Array): UnsealedKeyPayload {
  if (typeof window === "undefined") throw new Error("No storage");
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error("No lock cache present");
  const blob = JSON.parse(raw) as LockCacheBlob;
  if (blob.version !== CURRENT_VERSION) {
    throw new Error("Incompatible lock cache version");
  }
  const ciphertext = fromBase64(blob.ciphertext);
  const nonce = fromBase64(blob.nonce);
  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(unlockCacheKey, nonce).decrypt(ciphertext);
  } catch {
    throw new Error("Wrong password");
  }
  return JSON.parse(new TextDecoder().decode(plaintext)) as UnsealedKeyPayload;
}

/**
 * Wipe the lock cache. Called from:
 *   - Explicit logout (the sidebar sign-out button)
 *   - Password change / recovery (the old-password blob would no
 *     longer unwrap)
 *   - Any future "Lock all devices" flow
 *
 * Safe to call even if no blob exists.
 */
export function clearLockCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
