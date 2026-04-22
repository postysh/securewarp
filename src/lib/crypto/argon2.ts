/**
 * Argon2id entry point for the Next.js app.
 *
 * In a browser with a functional Worker constructor, `deriveMainKey`
 * is proxied into a dedicated web worker via Comlink so the ~1-2 s
 * KDF run doesn't freeze the login/signup/unlock UI. The worker is
 * spun up lazily on first call and kept alive for the life of the
 * document — the auth flow hits Argon2id up to twice in quick
 * succession (old + new password on rotate) and reusing the same
 * worker avoids the 20-30 ms worker startup + WASM instantiate cost
 * on the second call.
 *
 * In any environment without `Worker` (Node-side vitest runs, SSR
 * module eval), we fall back to the pure SDK implementation so
 * downstream consumers don't need to branch.
 */

import type { Remote } from "comlink";
import { wrap } from "comlink";
import type { Argon2Api } from "./argon2.worker";

let workerProxy: Remote<Argon2Api> | null = null;

function getWorkerProxy(): Remote<Argon2Api> {
  if (workerProxy) return workerProxy;
  const worker = new Worker(
    new URL("./argon2.worker.ts", import.meta.url),
    { type: "module" },
  );
  workerProxy = wrap<Argon2Api>(worker);
  return workerProxy;
}

export async function deriveMainKey(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  if (typeof Worker === "undefined") {
    const { deriveMainKey: impl } = await import(
      "@securewarp/sdk/crypto/argon2"
    );
    return impl(password, salt);
  }
  return getWorkerProxy().deriveMainKey(password, salt);
}
