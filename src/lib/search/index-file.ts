/**
 * Client-side helper to compute and POST search tokens for one file.
 *
 * Used by:
 *   - upload (after finalize)
 *   - rename (after server confirms the new name)
 *   - reindex / backfill flows
 *
 * Inputs are plaintext (filename + optional body text). The function
 * tokenizes, HMACs each token under `searchIndexKey`, and ships the
 * opaque hashes to /api/files/search/index. The plaintext never
 * leaves the browser.
 *
 * `searchIndexKeyB64` is the user's HMAC key, base64-encoded as it
 * lives in sessionStorage. We accept it in that form to avoid
 * decoding it at every call site.
 *
 * Failures are logged but not thrown — search indexing is a best-
 * effort enrichment; a failed index call should not break upload or
 * rename. Users can re-trigger via the manual reindex flow.
 */

import { fromBase64 } from "@/lib/crypto/utils";
import { tokenizeFile, tokenizeFilename } from "./tokenize";
import { hashTokens } from "./hash-token";

export async function indexFile(params: {
  fileId: string;
  filename: string;
  content?: string | null;
  searchIndexKeyB64: string;
}): Promise<void> {
  let key: Uint8Array | null = null;
  try {
    key = fromBase64(params.searchIndexKeyB64);
    const tokens = params.content !== undefined
      ? tokenizeFile(params.filename, params.content ?? null)
      : tokenizeFilename(params.filename);
    const hashes = hashTokens(tokens, key);
    const res = await fetch("/api/files/search/index", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: params.fileId, tokens: hashes }),
    });
    if (!res.ok) {
      let detail: unknown = null;
      try { detail = await res.json(); } catch { /* non-json */ }
      // eslint-disable-next-line no-console
      console.error("[search.index.client] non-OK response", {
        fileId: params.fileId,
        status: res.status,
        detail,
      });
    } else {
      // Verbose but invaluable for verifying the pipeline end-to-end.
      // Comment out once stable.
      // eslint-disable-next-line no-console
      console.log("[search.index.client] indexed", { fileId: params.fileId, tokens: hashes.length });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[search.index.client] threw", { fileId: params.fileId, err });
  } finally {
    if (key) {
      try {
        key.fill(0);
      } catch {
        // already detached
      }
    }
  }
}
