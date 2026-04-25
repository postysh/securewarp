/**
 * Round-trip + tamper resistance for the recovery-email wrap.
 *
 * The Argon2 path runs through `deriveMainKey` which uses a Worker in
 * the browser; in vitest's Node environment it falls back to the pure
 * SDK implementation, so no special setup is needed here.
 */

import { describe, it, expect } from "vitest";
import {
  wrapMnemonicForEmail,
  unwrapMnemonicFromEmail,
  rewrapMnemonicWithToken,
  cleanAndValidateMnemonic,
} from "./recovery-email-crypto";

const FIXTURE_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

describe("recovery-email wrap", () => {
  it("round-trips the mnemonic", async () => {
    const wrap = await wrapMnemonicForEmail(FIXTURE_MNEMONIC);
    const recovered = await unwrapMnemonicFromEmail({
      recoveryToken: wrap.recoveryToken,
      salt: wrap.salt,
      ciphertext: wrap.ciphertext,
    });
    expect(recovered).toBe(FIXTURE_MNEMONIC);
  }, 30_000);

  it("emits two distinct tokens", async () => {
    const wrap = await wrapMnemonicForEmail(FIXTURE_MNEMONIC);
    expect(wrap.recoveryToken).not.toBe(wrap.confirmToken);
    expect(wrap.recoveryToken.length).toBeGreaterThan(20);
    expect(wrap.confirmToken.length).toBeGreaterThan(20);
  }, 30_000);

  it("emits unique salt + ciphertext per call", async () => {
    const a = await wrapMnemonicForEmail(FIXTURE_MNEMONIC);
    const b = await wrapMnemonicForEmail(FIXTURE_MNEMONIC);
    expect(a.salt).not.toBe(b.salt);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  }, 60_000);

  it("rejects a wrong recovery token", async () => {
    const wrap = await wrapMnemonicForEmail(FIXTURE_MNEMONIC);
    // Force a different token of the same length so the Argon2
    // derivation produces a different wrap key. Just stripping a
    // suffix would still pass the length check; flipping the first
    // char to a guaranteed-different value (the next base64url char)
    // is the simplest reliable mutation.
    const first = wrap.recoveryToken[0];
    const flipped = first === "A" ? "B" : "A";
    const wrongToken = flipped + wrap.recoveryToken.slice(1);
    await expect(
      unwrapMnemonicFromEmail({
        recoveryToken: wrongToken,
        salt: wrap.salt,
        ciphertext: wrap.ciphertext,
      })
    ).rejects.toThrow();
  }, 30_000);

  it("cleanAndValidateMnemonic accepts a valid phrase", () => {
    expect(cleanAndValidateMnemonic(FIXTURE_MNEMONIC)).toBe(FIXTURE_MNEMONIC);
  });

  it("cleanAndValidateMnemonic strips numbered lines, NBSP, and ZWSP", () => {
    const messy =
      "1. abandon 2. abandon​ 3. abandon, 4. abandon; 5. abandon | 6. abandon\n" +
      "7. abandon 8. abandon 9. abandon 10. abandon 11. abandon 12. abandon\n" +
      "13. abandon 14. abandon 15. abandon 16. abandon 17. abandon 18. abandon\n" +
      "19. abandon 20. abandon 21. abandon 22. abandon 23. abandon 24. art";
    expect(cleanAndValidateMnemonic(messy)).toBe(FIXTURE_MNEMONIC);
  });

  it("cleanAndValidateMnemonic flags wrong word count", () => {
    expect(() => cleanAndValidateMnemonic("abandon abandon abandon")).toThrow(/3 words/);
  });

  it("cleanAndValidateMnemonic flags non-wordlist words by position", () => {
    const bad = FIXTURE_MNEMONIC.replace(/\bart\b/, "foobar");
    expect(() => cleanAndValidateMnemonic(bad)).toThrow(/word 24.*foobar/);
  });

  it("cleanAndValidateMnemonic flags a checksum-broken phrase", () => {
    // All-abandon (wrong final word) — every word is in the wordlist
    // but the BIP39 checksum byte is wrong.
    const noChecksum = FIXTURE_MNEMONIC.replace(/\bart\b/, "abandon");
    expect(() => cleanAndValidateMnemonic(noChecksum)).toThrow(/checksum|order|typo/i);
  });

  it("rewrapMnemonicWithToken keeps the original token usable", async () => {
    const wrap = await wrapMnemonicForEmail(FIXTURE_MNEMONIC);
    // Simulate a successful recovery — server now stores a NEW
    // wrap of a NEW mnemonic, sealed with the same recovery token.
    const newPhrase =
      "legal winner thank year wave sausage worth useful legal winner thank yellow " +
      "legal winner thank year wave sausage worth useful legal winner thank yellow";
    const next = await rewrapMnemonicWithToken(newPhrase, wrap.recoveryToken);
    expect(next.salt).not.toBe(wrap.salt);
    expect(next.ciphertext).not.toBe(wrap.ciphertext);
    const recovered = await unwrapMnemonicFromEmail({
      recoveryToken: wrap.recoveryToken,
      salt: next.salt,
      ciphertext: next.ciphertext,
    });
    expect(recovered).toBe(newPhrase);
  }, 60_000);

  it("rejects a tampered ciphertext", async () => {
    const wrap = await wrapMnemonicForEmail(FIXTURE_MNEMONIC);
    // Flip the last byte (the AEAD tag) so the auth check fails.
    const flipped = Buffer.from(wrap.ciphertext, "base64");
    flipped[flipped.length - 1] ^= 1;
    await expect(
      unwrapMnemonicFromEmail({
        recoveryToken: wrap.recoveryToken,
        salt: wrap.salt,
        ciphertext: flipped.toString("base64"),
      })
    ).rejects.toThrow();
  }, 30_000);
});
