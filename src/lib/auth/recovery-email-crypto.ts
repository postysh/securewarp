/**
 * Recovery-email wrap/unwrap. Client-side only.
 *
 * Cryptographic shape (see AGENTS.md → "Email" + threat model):
 *
 * 1. The user opts in. Client generates a fresh 32-byte recoveryToken
 *    and 16-byte salt.
 * 2. wrapKey = Argon2id(recoveryToken, salt) using the same parameters
 *    as `deriveMainKey` (t=3, m=64MB, p=1). The token is already a
 *    32-byte CSPRNG output, so this Argon2 step is defense-in-depth —
 *    it doesn't add brute-force resistance to a token attacker (the
 *    token entropy already does that), it just normalises the wrap
 *    key derivation into a single audited primitive.
 * 3. The 24-word BIP39 mnemonic is encrypted with XChaCha20-Poly1305
 *    under wrapKey. Plaintext is the mnemonic STRING; the existing
 *    recover() flow takes a string and runs HKDF on its entropy.
 * 4. The server stores `sha256(recoveryToken)` + ciphertext + salt.
 *    The plaintext token is briefly handled by the server only during
 *    email send and is delivered to the user via a URL fragment so it
 *    never re-enters a request body.
 *
 * Threat model: a database compromise that occurs AFTER the email is
 * sent reveals only the hash + ciphertext, neither of which is useful
 * without the token. A compromise during the email-send window can
 * read the plaintext token in the outbound payload — the same trust
 * window any password-reset flow has. The 24-word phrase remains the
 * strict zero-trust path; the recovery email is opt-in and labelled
 * as a convenience that costs the user a one-time email-trust
 * assumption.
 */

import { deriveMainKey } from "@/lib/crypto/argon2";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { toBase64, fromBase64, randomBytes } from "@/lib/crypto/utils";
import { validateMnemonic, wordlists } from "bip39";

const NONCE_LEN = 24;

export interface RecoveryEmailWrap {
  /** Base64url of the random recovery token. Lives in a URL fragment. */
  recoveryToken: string;
  /** Base64url of the random confirm token. Lives in the email's query string. */
  confirmToken: string;
  /** Base64 of the 16-byte Argon2id salt. */
  salt: string;
  /** Base64 of `nonce(24) || ciphertext || tag`. */
  ciphertext: string;
}

/**
 * Generate a fresh wrap of the user's 24-word mnemonic for email
 * recovery. Returns the plaintext tokens (which the caller MUST send
 * to the server in a single setup request and immediately discard
 * locally — the server emails them once and stores only hashes /
 * ciphertext) plus the ciphertext + salt to be persisted.
 */
export async function wrapMnemonicForEmail(mnemonic: string): Promise<RecoveryEmailWrap> {
  const recoveryTokenBytes = randomBytes(32);
  const confirmTokenBytes = randomBytes(32);
  const saltBytes = randomBytes(16);
  const nonce = randomBytes(NONCE_LEN);

  const wrapKey = await deriveMainKey(toBase64Url(recoveryTokenBytes), saltBytes);

  const aead = xchacha20poly1305(wrapKey, nonce);
  const plaintext = new TextEncoder().encode(mnemonic);
  const sealed = aead.encrypt(plaintext);

  const blob = new Uint8Array(NONCE_LEN + sealed.length);
  blob.set(nonce, 0);
  blob.set(sealed, NONCE_LEN);

  // Zero the wrap key as soon as the seal is done. The mnemonic
  // plaintext is a string — we can't zero it; the recover() caller
  // is expected to drop the local mnemonic copy after this call.
  wrapKey.fill(0);

  return {
    recoveryToken: toBase64Url(recoveryTokenBytes),
    confirmToken: toBase64Url(confirmTokenBytes),
    salt: toBase64(saltBytes),
    ciphertext: toBase64(blob),
  };
}

/**
 * Re-seal a fresh mnemonic under an existing recovery token. Used
 * during email-link recovery: the user clicks the saved link, we
 * unwrap the old phrase, the recover() flow generates a new phrase,
 * and we want the same email link to keep working for future
 * recoveries. We reuse the URL-fragment recoveryToken (the user
 * still has it in their saved email) but generate a fresh salt and
 * fresh nonce so the ciphertext is bound to the new phrase. Returns
 * only the salt + ciphertext — the token is unchanged.
 */
export async function rewrapMnemonicWithToken(
  mnemonic: string,
  recoveryToken: string
): Promise<{ salt: string; ciphertext: string }> {
  const saltBytes = randomBytes(16);
  const nonce = randomBytes(NONCE_LEN);

  const wrapKey = await deriveMainKey(recoveryToken, saltBytes);

  const aead = xchacha20poly1305(wrapKey, nonce);
  const sealed = aead.encrypt(new TextEncoder().encode(mnemonic));

  const blob = new Uint8Array(NONCE_LEN + sealed.length);
  blob.set(nonce, 0);
  blob.set(sealed, NONCE_LEN);

  wrapKey.fill(0);

  return {
    salt: toBase64(saltBytes),
    ciphertext: toBase64(blob),
  };
}

/**
 * Reverse of wrapMnemonicForEmail. Caller provides the recovery token
 * (from URL fragment), the salt + ciphertext (fetched from the server
 * after asserting the user-supplied account email matches a verified
 * recovery email), and gets back the 24-word mnemonic STRING.
 *
 * Throws on tag failure / corrupt ciphertext / wrong token.
 */
export async function unwrapMnemonicFromEmail(params: {
  recoveryToken: string;
  salt: string;
  ciphertext: string;
}): Promise<string> {
  const saltBytes = fromBase64(params.salt);
  const blob = fromBase64(params.ciphertext);
  if (blob.length < NONCE_LEN + 16) throw new Error("Ciphertext too short");

  const nonce = blob.subarray(0, NONCE_LEN);
  const sealed = blob.subarray(NONCE_LEN);

  const wrapKey = await deriveMainKey(params.recoveryToken, saltBytes);
  try {
    const aead = xchacha20poly1305(wrapKey, nonce);
    const plaintext = aead.decrypt(sealed);
    return new TextDecoder().decode(plaintext);
  } finally {
    wrapKey.fill(0);
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Cleaned + validated mnemonic. Throws with a user-readable error
 * message when the input doesn't parse as a valid 24 word BIP39
 * recovery phrase. Centralised so the wizard, the settings card,
 * and any future entry point all handle pasted phrases the same
 * way — including the tricky cases where a paste introduces
 * non-breaking spaces or zero-width characters that the simpler
 * `\s+` collapse leaves behind.
 */
export function cleanAndValidateMnemonic(raw: string): string {
  const cleaned = raw
    // NFKC normalisation collapses fullwidth chars, ligatures, and
    // the various Unicode space variants into their ASCII forms
    // before we run the simpler regex passes.
    .normalize("NFKC")
    // Zero-width joiners + bidi marks can ride along on copy/paste
    // from rich text and are invisible to the user. Strip them.
    .replace(/[​-‏‪-‮⁠-⁯﻿]/g, "")
    // Numbered list prefixes ("1. ", "12. ").
    .replace(/\d+\.\s*/g, "")
    // Common separators users substitute for spaces.
    .replace(/[,;|\t\r]/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!cleaned) {
    throw new Error("Paste your 24 word recovery phrase.");
  }

  const words = cleaned.split(" ");
  if (words.length !== 24) {
    throw new Error(
      `We see ${words.length} word${words.length === 1 ? "" : "s"}. A recovery phrase is exactly 24.`
    );
  }

  const list = wordlists.english as string[] | undefined;
  if (list) {
    const set = new Set(list);
    const bad: string[] = [];
    words.forEach((w, i) => {
      if (!set.has(w)) bad.push(`word ${i + 1} (“${w}”)`);
    });
    if (bad.length > 0) {
      throw new Error(
        `${bad.slice(0, 3).join(", ")}${bad.length > 3 ? `, +${bad.length - 3} more` : ""} ${
          bad.length === 1 ? "isn’t" : "aren’t"
        } in the recovery wordlist. Check for typos.`
      );
    }
  }

  if (!validateMnemonic(cleaned)) {
    throw new Error(
      "These words are valid recovery words but the order or one entry is wrong. Recovery phrases include a built in checksum, so a single typo or transposition will fail. Recheck the order."
    );
  }

  return cleaned;
}
