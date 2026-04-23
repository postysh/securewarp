/**
 * Argon2id web worker.
 *
 * Argon2id is the single longest-running crypto op on the main
 * thread — ~1-2 s of WASM execution at our parameters (64 MB,
 * t=3). Doing it inline freezes input, hover state, and the spinner
 * at every login, signup, recovery, unlock, and change-password.
 * Moving it to a worker keeps the main thread responsive while the
 * KDF runs.
 *
 * The worker imports the same pure `deriveMainKey` from `@securewarp/sdk`
 * that non-browser consumers (tests, desktop, CLI) use — the worker
 * is purely an execution-context change, not a crypto change. The
 * bit-identity compat test in `packages/sdk/src/crypto/argon2-compat.test.ts`
 * still guards the implementation.
 *
 * Only Argon2id is off-loaded here. XChaCha20 per-chunk encrypt/decrypt
 * runs in its own worker pool (`chunk-pool.ts`) — at 16 MB per chunk,
 * HAR measurements showed pure-JS noble was eating ~400 ms of main-
 * thread CPU per chunk, which bottlenecked the 5-way network pipeline.
 * HKDF is <1 ms and stays on the main thread.
 */

import { expose } from "comlink";
import { deriveMainKey as deriveMainKeyImpl } from "@securewarp/sdk/crypto/argon2";

const api = {
  async deriveMainKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
    return deriveMainKeyImpl(password, salt);
  },
};

export type Argon2Api = typeof api;

expose(api);
