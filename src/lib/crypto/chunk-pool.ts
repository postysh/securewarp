/**
 * XChaCha20-Poly1305 chunk crypto pool.
 *
 * Owns a fixed-size pool of web workers and round-robin-dispatches
 * encrypt/decrypt jobs to them. Transferable `ArrayBuffer`s move
 * chunk payloads across the worker boundary with zero copy so the
 * postMessage cost is O(1) per call regardless of chunk size.
 *
 * Why a pool rather than a single worker: a single worker still
 * serializes internally, which was the original bottleneck — just
 * off the main thread instead of on it. 3-4 workers let us actually
 * overlap chunk encrypts across cores, which is what finally
 * unblocks the 5-way network pipeline.
 *
 * Pool size = max(1, min(4, hardwareConcurrency - 1)): leave one
 * core for the main thread + browser work, cap at 4 to bound heap
 * use on mobile (each worker has its own JS heap loading
 * `@noble/ciphers`).
 *
 * Node/SSR fallback: when `Worker` is undefined (vitest runs,
 * SSR module eval), run the pure SDK impl on whatever thread the
 * caller is on. The ciphertext is byte-identical by construction —
 * the pool is an execution-context optimization, not a crypto
 * change.
 */

import { wrap, transfer, type Remote } from "comlink";
import type { ChunkWorkerApi } from "./chunk-worker";
import type { EncryptedChunk } from "@securewarp/sdk/crypto/chunked-encryption";

export interface ChunkPool {
  encrypt(
    chunkData: Uint8Array,
    index: number,
    isFinal: boolean,
    sessionKey: Uint8Array,
  ): Promise<EncryptedChunk>;
  decrypt(
    ciphertext: Uint8Array,
    nonceB64: string,
    expectedIndex: number,
    expectedFinal: boolean,
    sessionKey: Uint8Array,
  ): Promise<Uint8Array>;
}

let cached: ChunkPool | null = null;

function detectPoolSize(): number {
  // `navigator.hardwareConcurrency` is an anti-fingerprinting signal as
  // much as a hardware one — Safari caps it at 2 on some configs, which
  // would collapse our pool to 1 worker and re-serialize decrypt (HAR
  // showed this in practice: 5-way network pipeline but ~400 ms gaps
  // between batches, matching a single worker draining one chunk at a
  // time). Floor at 3 so we always get parallelism across cores, cap at
  // 6 to bound per-worker heap (each holds its own @noble/ciphers JS
  // state, ~5–10 MB). Missing/unreadable → default to 4.
  const hw =
    (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  return Math.max(3, Math.min(6, hw));
}

function createWorkerPool(): ChunkPool {
  const size = detectPoolSize();
  const workers: Remote<ChunkWorkerApi>[] = [];
  for (let i = 0; i < size; i++) {
    const w = new Worker(new URL("./chunk-worker.ts", import.meta.url), {
      type: "module",
    });
    workers.push(wrap<ChunkWorkerApi>(w));
  }
  let next = 0;
  const pick = (): Remote<ChunkWorkerApi> => {
    const w = workers[next];
    next = (next + 1) % workers.length;
    return w;
  };
  return {
    async encrypt(chunkData, index, isFinal, sessionKey) {
      return pick().encrypt(
        transfer(chunkData, [chunkData.buffer]),
        index,
        isFinal,
        sessionKey,
      );
    },
    async decrypt(ciphertext, nonceB64, expectedIndex, expectedFinal, sessionKey) {
      return pick().decrypt(
        transfer(ciphertext, [ciphertext.buffer]),
        nonceB64,
        expectedIndex,
        expectedFinal,
        sessionKey,
      );
    },
  };
}

function createFallbackPool(): ChunkPool {
  return {
    async encrypt(chunkData, index, isFinal, sessionKey) {
      const mod = await import("@securewarp/sdk/crypto/chunked-encryption");
      return mod.encryptChunk(chunkData, index, isFinal, sessionKey);
    },
    async decrypt(ciphertext, nonceB64, expectedIndex, expectedFinal, sessionKey) {
      const mod = await import("@securewarp/sdk/crypto/chunked-encryption");
      return mod.decryptChunk(
        ciphertext,
        nonceB64,
        expectedIndex,
        expectedFinal,
        sessionKey,
      );
    },
  };
}

export function getChunkPool(): ChunkPool {
  if (cached) return cached;
  cached =
    typeof Worker === "undefined" ? createFallbackPool() : createWorkerPool();
  return cached;
}
