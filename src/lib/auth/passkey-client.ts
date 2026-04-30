"use client";

/**
 * Passkey client orchestration. Handles the WebAuthn ceremony, derives
 * the wrap key from the PRF extension output, seals the user's
 * decrypted private keys for per-credential storage, and unwraps them
 * on a passkey login.
 *
 * Zero-knowledge invariants (cross-ref AGENTS.md):
 *   - The PRF output never leaves the browser. It travels through
 *     `clientExtensionResults` (already client-side) → HKDF → wrap
 *     key → XChaCha20-Poly1305. Only the ciphertext + nonce + the
 *     non-secret PRF salt go in the request body.
 *   - The wrap key Uint8Array is `.fill(0)`'d in `finally` on every
 *     exit path. Strings (base64 priv-hier keys) can't be zeroed —
 *     same accepted tradeoff as elsewhere in the codebase.
 *   - The PRF salt is a fixed application-wide constant. Per-
 *     credential salts would force a two-pass WebAuthn dance (one
 *     get() to identify the credential, a second to derive its
 *     secret) which means two biometric prompts per login. The
 *     credential's own secret already provides per-user uniqueness
 *     of the PRF output, so the salt only needs to scope the
 *     derivation to "this app". The DB column carries the constant
 *     for forward-compat — if we ever want per-credential salts,
 *     newly enrolled rows can store a fresh value without breaking
 *     older ones.
 */

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import {
  toBase64,
  fromBase64,
  randomBytes,
  utf8Encode,
} from "@/lib/crypto/utils";

const HKDF_SALT = utf8Encode("securewarp-passkey-wrap-v1");
const HKDF_INFO = utf8Encode("securewarp-passkey-wrap-v1");
const KEY_LENGTH = 32;
const NONCE_LEN = 24;

/**
 * Constant 32-byte PRF salt used for every credential. Domain-
 * separated from any other HMAC/PRF input the app uses. Not a secret.
 */
export const PASSKEY_PRF_SALT_BYTES: Uint8Array = sha256(
  utf8Encode("securewarp-passkey-prf-eval-v1"),
);

export const PASSKEY_PRF_SALT_BASE64URL: string = toBase64Url(
  PASSKEY_PRF_SALT_BYTES,
);

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4;
  const padded = pad ? s + "=".repeat(4 - pad) : s;
  return fromBase64(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

/**
 * Run a 32-byte wrap key out of the PRF output. Caller is responsible
 * for `.fill(0)`'ing the returned Uint8Array when done.
 */
export function derivePasskeyWrapKey(prfOutput: Uint8Array): Uint8Array {
  return hkdf(sha256, prfOutput, HKDF_SALT, HKDF_INFO, KEY_LENGTH);
}

interface UserDataPlaintext {
  encryptionPrivateKey: string;
  kemPrivateKey: string;
}

export interface WrappedUserData {
  ciphertext: string;
  nonce: string;
}

/**
 * Seal the user's decrypted private keys under the PRF-derived wrap
 * key. Input plaintext stays in caller-managed memory; this function
 * only transiently holds the JSON-encoded bytes (zeroed in finally).
 */
export function wrapUserData(
  plaintext: UserDataPlaintext,
  prfOutput: Uint8Array,
): WrappedUserData {
  const json = JSON.stringify(plaintext);
  const messageBytes = new TextEncoder().encode(json);
  const nonce = randomBytes(NONCE_LEN);
  let wrapKey: Uint8Array | null = null;
  try {
    wrapKey = derivePasskeyWrapKey(prfOutput);
    const ciphertext = xchacha20poly1305(wrapKey, nonce).encrypt(messageBytes);
    return {
      ciphertext: toBase64(ciphertext),
      nonce: toBase64(nonce),
    };
  } finally {
    if (wrapKey) wrapKey.fill(0);
    messageBytes.fill(0);
  }
}

export function unwrapUserData(
  wrapped: WrappedUserData,
  prfOutput: Uint8Array,
): UserDataPlaintext {
  let wrapKey: Uint8Array | null = null;
  let plaintext: Uint8Array | null = null;
  try {
    wrapKey = derivePasskeyWrapKey(prfOutput);
    const ciphertext = fromBase64(wrapped.ciphertext);
    const nonce = fromBase64(wrapped.nonce);
    plaintext = xchacha20poly1305(wrapKey, nonce).decrypt(ciphertext);
    const parsed = JSON.parse(new TextDecoder().decode(plaintext));
    if (
      typeof parsed.encryptionPrivateKey !== "string" ||
      typeof parsed.kemPrivateKey !== "string"
    ) {
      throw new Error("invalid wrapped user-data shape");
    }
    return {
      encryptionPrivateKey: parsed.encryptionPrivateKey,
      kemPrivateKey: parsed.kemPrivateKey,
    };
  } finally {
    if (wrapKey) wrapKey.fill(0);
    if (plaintext) plaintext.fill(0);
  }
}

/**
 * Returns true when the browser supports WebAuthn AND the PRF
 * extension. Without PRF support we can't derive a stable wrap key,
 * so passkey enrollment isn't safe to offer. Callers should hide the
 * "Add a passkey" button when this returns false.
 */
export async function passkeyPrfSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!window.PublicKeyCredential) return false;
  // getClientCapabilities is the explicit support probe, but it's
  // recent (Chrome 133+, Safari 18+). Older browsers without it but
  // with a platform authenticator + PRF support exist; treat the
  // missing API as "unknown — try it" rather than a hard no.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window.PublicKeyCredential as any).getClientCapabilities;
  if (typeof cap === "function") {
    try {
      const caps = await cap();
      // The PRF capability is reported as `extension:prf`. Unsupported
      // browsers omit it from the result map entirely.
      return Boolean(caps && caps["extension:prf"]);
    } catch {
      return false;
    }
  }
  return true;
}

interface EnrollPasskeyParams {
  nickname: string;
  plaintext: UserDataPlaintext;
}

/**
 * End-to-end passkey enrollment. Caller supplies the user's
 * already-decrypted private keys (sessionStorage payload), this
 * function drives the WebAuthn ceremony, derives the wrap key from
 * the PRF output, encrypts a per-credential copy of the keys, and
 * persists the credential server-side.
 *
 * Throws on any failure — the caller's UI should surface a generic
 * "couldn't enroll passkey" message; specific errors leak which
 * browser/authenticator a user has, which isn't a value-add.
 */
export async function enrollPasskey(params: EnrollPasskeyParams): Promise<void> {
  const optionsRes = await fetch("/api/auth/passkey/register-options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!optionsRes.ok) {
    throw new Error("Failed to start enrollment");
  }
  const { options, challengeToken, prfSalt } = (await optionsRes.json()) as {
    options: PublicKeyCredentialCreationOptionsJSON;
    challengeToken: string;
    prfSalt: string;
  };

  // Inject the PRF eval salt. Server doesn't pre-fill it because the
  // salt is an application constant, not user-derived.
  const optionsWithPrf: PublicKeyCredentialCreationOptionsJSON = {
    ...options,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extensions: {
      ...(options.extensions ?? {}),
      prf: { eval: { first: PASSKEY_PRF_SALT_BASE64URL } },
    } as any,
  };

  const attestation = await startRegistration({ optionsJSON: optionsWithPrf });

  const prfOutput = extractPrfOutput(attestation);
  if (!prfOutput) {
    throw new Error(
      "This authenticator doesn't support the PRF extension. Try a different device or password manager.",
    );
  }

  let wrapped: WrappedUserData;
  try {
    wrapped = wrapUserData(params.plaintext, prfOutput);
  } finally {
    prfOutput.fill(0);
  }

  const verifyRes = await fetch("/api/auth/passkey/register-verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      attestationResponse: attestation,
      challengeToken,
      prfSalt,
      wrappedUserData: wrapped.ciphertext,
      wrappedUserDataNonce: wrapped.nonce,
      nickname: params.nickname,
    }),
  });
  if (!verifyRes.ok) {
    const body = (await verifyRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to enroll passkey");
  }
}

export interface PasskeyLoginResult {
  email: string;
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
  kemPublicKey: string;
  kemPrivateKey: string;
}

/**
 * End-to-end passkey login. Drives the WebAuthn assertion, posts to
 * the verify endpoint, then unwraps the per-credential copy of the
 * user's private keys with the PRF-derived key. The session cookie
 * is set by the server inside login-verify; this function returns
 * the unwrapped key material for the caller to load into
 * sessionStorage (matching the password-login flow).
 */
export async function loginWithPasskey(): Promise<PasskeyLoginResult> {
  const optionsRes = await fetch("/api/auth/passkey/login-options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!optionsRes.ok) {
    throw new Error("Failed to start sign-in");
  }
  const { options, challengeToken } = (await optionsRes.json()) as {
    options: PublicKeyCredentialRequestOptionsJSON;
    challengeToken: string;
  };

  const optionsWithPrf: PublicKeyCredentialRequestOptionsJSON = {
    ...options,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extensions: {
      ...(options.extensions ?? {}),
      prf: { eval: { first: PASSKEY_PRF_SALT_BASE64URL } },
    } as any,
  };

  const assertion = await startAuthentication({ optionsJSON: optionsWithPrf });

  const prfOutput = extractPrfOutput(assertion);
  if (!prfOutput) {
    throw new Error(
      "Couldn't derive a key from this passkey. Use your password to sign in.",
    );
  }

  try {
    const verifyRes = await fetch("/api/auth/passkey/login-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assertionResponse: assertion,
        challengeToken,
      }),
    });
    if (!verifyRes.ok) {
      const body = (await verifyRes.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(body.error ?? "Sign-in failed");
    }
    const data = (await verifyRes.json()) as {
      wrappedUserData: string;
      wrappedUserDataNonce: string;
      prfSalt: string;
      email: string;
      publicEncryptionKey: string;
      publicKemKey: string;
    };

    const plaintext = unwrapUserData(
      { ciphertext: data.wrappedUserData, nonce: data.wrappedUserDataNonce },
      prfOutput,
    );

    return {
      email: data.email,
      encryptionPublicKey: data.publicEncryptionKey,
      encryptionPrivateKey: plaintext.encryptionPrivateKey,
      kemPublicKey: data.publicKemKey,
      kemPrivateKey: plaintext.kemPrivateKey,
    };
  } finally {
    prfOutput.fill(0);
  }
}

/**
 * Pull the PRF output from a WebAuthn response's clientExtensionResults.
 * Returns a fresh Uint8Array the caller owns (and must zero). Returns
 * null when the authenticator didn't surface a PRF result — usually
 * means the extension isn't supported on this device.
 */
function extractPrfOutput(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: any,
): Uint8Array | null {
  const ext = response?.clientExtensionResults;
  const first = ext?.prf?.results?.first;
  if (typeof first !== "string") return null;
  return fromBase64Url(first);
}

