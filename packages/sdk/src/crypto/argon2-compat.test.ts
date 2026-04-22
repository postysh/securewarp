/**
 * Bit-identity gate for the Argon2 library swap.
 *
 * `deriveMainKey` is the root of the entire authenticated-key tree:
 * master key → HKDF → srpKey / passwordDerivedSecret / unlockCacheKey.
 * If the Argon2 output drifts by a single byte between implementations,
 * every existing user's lockCache becomes unopenable, their SRP verifier
 * is junk, and they're permanently locked out.
 *
 * Argon2id is deterministic given (password, salt, time, memory,
 * parallelism, hashLength, version). This test asserts that the new
 * library (`hash-wasm`) produces the same 32 bytes as the pure-JS
 * reference (`@noble/hashes/argon2`) at the parameters SecureWarp uses.
 * If this ever fails, do not swap the library — one of them diverged
 * from RFC 9106.
 *
 * An earlier candidate `@phi-ag/argon2` (v0.5.21) was rejected during
 * this gate: it passes JS `password.length` (character count) to its
 * WASM `argon2_hash` instead of the UTF-8 byte length, silently
 * truncating any password with non-ASCII characters mid-sequence. That
 * would lock out every user with an accented character in their
 * password. `hash-wasm` pre-encodes the password to a Uint8Array
 * before taking its byte length, matching RFC 9106 and @noble.
 */

import { describe, it, expect } from "vitest";
import { argon2id as nobleArgon2id } from "@noble/hashes/argon2.js";
import { argon2id as hashWasmArgon2id } from "hash-wasm";

const MEMORY_KB = 65536; // 64 MB — SecureWarp production parameter
const TIME = 3;
const PARALLELISM = 1;
const HASH_LEN = 32;

describe("argon2 cross-library compatibility", () => {
  it("hash-wasm matches @noble/hashes/argon2 at production params", async () => {
    const password = "correct-horse-battery-staple";
    const salt = new Uint8Array([
      0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
      0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00,
    ]);

    const reference = nobleArgon2id(password, salt, {
      t: TIME,
      m: MEMORY_KB,
      p: PARALLELISM,
      dkLen: HASH_LEN,
      version: 0x13,
    });

    const result = await hashWasmArgon2id({
      password,
      salt,
      iterations: TIME,
      memorySize: MEMORY_KB,
      parallelism: PARALLELISM,
      hashLength: HASH_LEN,
      outputType: "binary",
    });

    expect(result).toEqual(reference);
    expect(result.length).toBe(HASH_LEN);
  });

  it("matches across ASCII, unicode, long, and empty passwords", { timeout: 60_000 }, async () => {
    // Every case must bit-match noble. The unicode case is the one
    // that rejected @phi-ag during the first round of this gate —
    // non-ASCII passwords must not silently truncate.
    const cases: Array<{ label: string; password: string; salt: Uint8Array }> = [
      { label: "ascii short", password: "a", salt: new Uint8Array(16).fill(0xab) },
      { label: "ascii long", password: "x".repeat(200), salt: new Uint8Array(32).fill(0x7f) },
      { label: "unicode latin", password: "passwörd", salt: new Uint8Array(16).fill(0xa5) },
      { label: "unicode cjk", password: "密码パスワード", salt: new Uint8Array(16).fill(0xc3) },
      { label: "emoji", password: "hunter2🔐🗝️", salt: new Uint8Array(16).fill(0xe1) },
    ];

    for (const { label, password, salt } of cases) {
      const reference = nobleArgon2id(password, salt, {
        t: TIME,
        m: MEMORY_KB,
        p: PARALLELISM,
        dkLen: HASH_LEN,
        version: 0x13,
      });

      const result = await hashWasmArgon2id({
        password,
        salt,
        iterations: TIME,
        memorySize: MEMORY_KB,
        parallelism: PARALLELISM,
        hashLength: HASH_LEN,
        outputType: "binary",
      });

      expect(result, `mismatch on ${label}`).toEqual(reference);
    }
  });

  it("matches at the link-password params (t=2, m=32 MB)", async () => {
    // Defense for a future consolidation where deriveLinkWrappingKey
    // might move off @noble/hashes to hash-wasm for SIMD speed.
    const password = "link-password-test";
    const salt = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe, 1, 2, 3, 4, 5, 6, 7, 8]);

    const reference = nobleArgon2id(password, salt, {
      t: 2,
      m: 32 * 1024,
      p: 1,
      dkLen: 32,
      version: 0x13,
    });

    const result = await hashWasmArgon2id({
      password,
      salt,
      iterations: 2,
      memorySize: 32 * 1024,
      parallelism: 1,
      hashLength: 32,
      outputType: "binary",
    });

    expect(result).toEqual(reference);
  });
});
