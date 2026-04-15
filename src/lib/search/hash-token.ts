/**
 * HMAC-SHA256 a token under the user's `searchIndexKey`.
 *
 * Output is a 32-byte opaque blob, base64-encoded for transit. The
 * server stores these hashes in `file_search_tokens.token_hash` and
 * matches them against the hashes the client computes for queries.
 *
 * Determinism is required: the same token + key always produces the
 * same hash, so insert-time hashes match query-time hashes. That is
 * also the (intentional) leak — a long-running server-side observer
 * can build a frequency histogram of hashes seen in queries. We
 * accept this; documented in SECURITY.md.
 */

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8Encode, toBase64 } from "../crypto/utils";
import type { Token } from "./tokenize";

export function hashToken(token: Token, searchIndexKey: Uint8Array): string {
  const mac = hmac(sha256, searchIndexKey, utf8Encode(token));
  return toBase64(mac);
}

export function hashTokens(tokens: Token[], searchIndexKey: Uint8Array): string[] {
  return tokens.map((t) => hashToken(t, searchIndexKey));
}
