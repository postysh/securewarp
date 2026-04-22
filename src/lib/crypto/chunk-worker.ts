/**
 * Chunk crypto worker.
 *
 * XChaCha20-Poly1305 on an 8 MB chunk costs ~390 ms of main-thread
 * CPU in pure-JS `@noble/ciphers`. HAR analysis showed this was the
 * actual upload bottleneck once chunk size + read-pipelining were
 * fixed: five PUTs would never overlap fully because encryption
 * serialized them on the single main thread. A pool of these workers
 * (see `chunk-pool.ts`) parallelizes encrypt/decrypt across cores,
 * letting all configured in-flight network streams run at their
 * actual network throughput.
 *
 * Implementation is the pure SDK function — no crypto change, just a
 * different execution context. The bit-identity gates in
 * `packages/sdk/src/crypto/adversarial.test.ts` still cover the
 * implementation.
 */

import { expose, transfer } from "comlink";
import {
  encryptChunk as encryptImpl,
  decryptChunk as decryptImpl,
} from "@securewarp/sdk/crypto/chunked-encryption";

const api = {
  async encrypt(
    chunkData: Uint8Array,
    index: number,
    isFinal: boolean,
    sessionKey: Uint8Array,
  ) {
    const result = encryptImpl(chunkData, index, isFinal, sessionKey);
    // Transfer the ciphertext's backing buffer back to the caller —
    // avoids a structured-clone copy of the multi-MB payload. The
    // main side is the only reader after this; no concurrent reader
    // on the worker.
    return transfer(result, [result.ciphertext.buffer]);
  },
  async decrypt(
    ciphertext: Uint8Array,
    nonceB64: string,
    expectedIndex: number,
    expectedFinal: boolean,
    sessionKey: Uint8Array,
  ) {
    const result = decryptImpl(
      ciphertext,
      nonceB64,
      expectedIndex,
      expectedFinal,
      sessionKey,
    );
    return transfer(result, [result.buffer]);
  },
};

export type ChunkWorkerApi = typeof api;

expose(api);
