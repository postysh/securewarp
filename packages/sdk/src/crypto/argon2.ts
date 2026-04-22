/**
 * Argon2id key derivation — client-side only (WASM).
 *
 * Swapped from `argon2-browser` → `hash-wasm` on 2026-04-22. Both
 * implement RFC 9106 Argon2id v0x13, so output is bit-identical at
 * identical parameters; see `argon2-compat.test.ts` for the gate.
 * hash-wasm is actively maintained, SIMD-built, and smaller than
 * argon2-browser's bundled WASM. argon2-browser has no known CVEs —
 * the swap is a maintenance + perf move, not a security fix.
 *
 * Not migrated to `@phi-ag/argon2` despite its better benchmarks:
 * v0.5.21 passes the JS `password.length` (character count) into
 * the WASM `argon2_hash` call instead of the UTF-8 byte length,
 * silently truncating any non-ASCII password mid-sequence. That would
 * lock out every user with an accented character, emoji, or CJK
 * character in their password. Filed mentally for revisit when the
 * upstream bug is fixed.
 *
 * Parameters: 64 MB memory, 3 iterations, parallelism 1.
 */

import { argon2id } from "hash-wasm";

const ARGON2_MEMORY = 65536; // 64 MB in KiB
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH = 32;

export async function deriveMainKey(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  // outputType: "binary" returns the raw 32-byte hash. "hex" (default)
  // would give us a string of length 64. We want bytes for HKDF input,
  // so binary is correct.
  const result = await argon2id({
    password,
    salt,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY,
    parallelism: ARGON2_PARALLELISM,
    hashLength: ARGON2_HASH_LENGTH,
    outputType: "binary",
  });

  return result;
}
