/**
 * Argon2id key derivation — runs client-side only (WASM).
 *
 * Takes password + salt → 32-byte master key.
 * Parameters: 64 MB memory, 3 iterations, parallelism 1.
 */

import argon2 from "argon2-browser/dist/argon2-bundled.min.js";

const ARGON2_MEMORY = 65536; // 64 MB in KiB
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH = 32;

export async function deriveMainKey(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const result = await argon2.hash({
    pass: password,
    salt,
    time: ARGON2_ITERATIONS,
    mem: ARGON2_MEMORY,
    parallelism: ARGON2_PARALLELISM,
    hashLen: ARGON2_HASH_LENGTH,
    type: argon2.ArgonType.Argon2id,
  });

  return new Uint8Array(result.hash);
}
