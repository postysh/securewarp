"use client";

import type { DecryptRequest, DecryptResult } from "./decrypt-worker";

/**
 * Promise-based wrapper around the metadata decrypt worker.
 *
 * Why: fetchFiles used to run unwrapPrivateHierarchicalKey +
 * unwrapSessionKeyFromFile + decryptMetadata for every row on the
 * main thread. For a 500-file folder, that's ~500–1000 ms of
 * blocking work; the skeleton freezes and clicks feel dead until
 * it finishes. Moving the work to a worker keeps the main thread
 * free to paint the shell while decrypt runs.
 *
 * Scope: direct-access rows only (files where the caller has a
 * file_keys row of their own). Inherited rows that need a parent
 * chain walk stay on the main thread — that path does async
 * fetches for intermediate parents and is harder to untangle.
 *
 * Security: the worker receives the user's decrypted privates over
 * postMessage. Workers share the same origin as the main app and
 * the main thread already holds these keys in sessionStorage, so
 * nothing crosses a trust boundary. The worker is module-scoped
 * (one shared instance) so we aren't spawning a new process per
 * navigation.
 */

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (r: DecryptResult["results"]) => void; reject: (e: unknown) => void }
>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  worker = new Worker(new URL("./decrypt-worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (e: MessageEvent<DecryptResult>) => {
    const { id, results } = e.data;
    const slot = pending.get(id);
    if (!slot) return;
    pending.delete(id);
    slot.resolve(results);
  };
  worker.onerror = (e) => {
    // Fail any in-flight requests; subsequent calls will retry with
    // a fresh worker instance.
    for (const [, slot] of pending) slot.reject(e);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/**
 * Decrypt a batch of file rows on the worker. Resolves with the
 * per-file results in input order. Rejects on worker error. Returns
 * null when the runtime has no Worker support (SSR / unusual
 * browser) — callers must fall back to the main-thread path.
 */
export function decryptMetadataBatch(
  req: Omit<DecryptRequest, "id">,
): Promise<DecryptResult["results"]> | null {
  const w = getWorker();
  if (!w) return null;
  const id = nextRequestId++;
  return new Promise<DecryptResult["results"]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, ...req } satisfies DecryptRequest);
  });
}
