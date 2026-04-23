import "server-only";
import { AwsClient } from "aws4fetch";

// Cloudflare Workers-compatible R2 client using aws4fetch (lightweight,
// Web-standard fetch-based signing). Replaces @aws-sdk/client-s3 which
// pulls in ~2MB of Node-only code and doesn't run on Workers.
//
// Lazy singleton — same reasoning as src/lib/db/supabase.ts:
// Cloudflare Workers Builds runs `next build` without runtime secrets,
// and Next's "collect page data" phase imports every route module. If
// we instantiate AwsClient at module load, the build fails because the
// AwsClient constructor validates that accessKeyId is present. Deferring
// to first use sidesteps that entirely.

let _client: AwsClient | null = null;

function getClient(): AwsClient {
  if (_client) return _client;
  _client = new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  });
  return _client;
}

// ─── Multi-bucket sharding ────────────────────────────────────────────
//
// Chunks are distributed across N independent R2 buckets so the browser
// opens N separate TCP connections (one per bucket hostname) instead of
// multiplexing all streams over a single connection. With 5 shards the
// pipeline is no longer bottlenecked by any one TCP congestion window.
//
// The shard index is persisted on `file_chunks.shard` at upload time
// and used by every read path (download, rotate, delete) to route to
// the correct bucket. Distribution is deterministic round-robin by
// chunk sequence, picked per-chunk via `shardForChunk`.
//
// Security note: this changes WHERE ciphertext is stored, NOT how it's
// generated. Zero-knowledge invariants are unchanged — the server still
// mints presigned URLs without ever touching bytes.
//
// All shards share the same account-level R2 access key/secret and the
// same endpoint host (account-scoped); only the bucket path segment
// differs. The SigV4 signature is bucket-aware via the URL path, so no
// per-bucket credential management is needed.
export const SHARD_COUNT = 5;

export function shardForChunk(sequence: number): number {
  // Round-robin by chunk sequence. Even distribution at steady state
  // (each in-flight chunk at CONCURRENT_CHUNK_UPLOADS=5 hits a distinct
  // shard). Deterministic so the server can regenerate the right URL
  // from just (fileId, chunkIndex) during retry/refresh without a DB
  // round-trip.
  return sequence % SHARD_COUNT;
}

export function bucketForShard(shard: number): string {
  if (!Number.isInteger(shard) || shard < 0 || shard >= SHARD_COUNT) {
    throw new Error(`Invalid shard index: ${shard}`);
  }
  return `securewarp-shard-${shard}`;
}

function buildUrl(shard: number, storageKey: string): string {
  const endpoint = process.env.R2_ENDPOINT!;
  const bucket = bucketForShard(shard);
  // R2 endpoint is typically https://<account>.r2.cloudflarestorage.com
  // The bucket is a path segment, key is the rest of the path.
  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  // Encode each path segment individually so literal slashes between
  // segments are preserved (AWS SigV4 + S3/R2 require real `/` in the
  // object path — encoding the whole key with encodeURIComponent would
  // turn `user/file/chunk` into `user%2Ffile%2Fchunk`, which doesn't
  // match the key R2 actually stored and also breaks signature parity
  // with clients that uploaded via the AWS SDK).
  const encodedKey = storageKey.split("/").map(encodeURIComponent).join("/");
  return `${base}/${bucket}/${encodedKey}`;
}

// Presigned URL expiry. 6 hours comfortably covers a 25 GB upload on
// a slow home uplink (~60 min wall time) and a chunked download of a
// multi-GB video (sequential R2 fetches over a slow link can take
// 30+ min). URLs are capability tokens for a single object, not
// credentials; 6h is well within S3/R2 norms (S3 allows up to 7d).
const PRESIGNED_URL_TTL_SECONDS = "21600";

/**
 * Generate a presigned URL for uploading an encrypted blob to a
 * specific shard's bucket. Client uploads directly to R2 — the server
 * never touches the ciphertext.
 */
export async function getUploadUrl(shard: number, storageKey: string): Promise<string> {
  // Pre-set X-Amz-Expires BEFORE signing. It's part of the canonical
  // query string, so mutating it after sign() invalidates the signature.
  // aws4fetch defaults to 3600s if we don't specify.
  const url = new URL(buildUrl(shard, storageKey));
  url.searchParams.set("X-Amz-Expires", PRESIGNED_URL_TTL_SECONDS);
  const signed = await getClient().sign(
    new Request(url.toString(), { method: "PUT" }),
    { aws: { signQuery: true } }
  );
  return signed.url;
}

/**
 * Generate a presigned URL for downloading an encrypted blob from a
 * specific shard's bucket.
 */
export async function getDownloadUrl(shard: number, storageKey: string): Promise<string> {
  const url = new URL(buildUrl(shard, storageKey));
  url.searchParams.set("X-Amz-Expires", PRESIGNED_URL_TTL_SECONDS);
  const signed = await getClient().sign(
    new Request(url.toString(), { method: "GET" }),
    { aws: { signQuery: true } }
  );
  return signed.url;
}

/**
 * Delete a single encrypted blob from a specific shard's bucket.
 */
export async function deleteBlob(shard: number, storageKey: string): Promise<void> {
  const url = buildUrl(shard, storageKey);
  const res = await getClient().fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 delete failed: ${res.status} ${res.statusText}`);
  }
}

/**
 * Bulk-delete multiple blobs, grouped by shard, issuing one S3
 * DeleteObjects call per bucket. Callers pass a flat array of
 * `{shard, storageKey}` records and this fans out to the right
 * buckets transparently. No-op on empty input.
 *
 * R2's S3-compatible DeleteObjects accepts up to 1000 keys per call;
 * we chunk to 1000 just in case a single shard accumulates more than
 * that (unusual but possible for a purge of a large account).
 */
export async function deleteBlobs(
  items: { shard: number; storageKey: string }[],
): Promise<void> {
  if (items.length === 0) return;

  const byShard = new Map<number, string[]>();
  for (const item of items) {
    const keys = byShard.get(item.shard) ?? [];
    keys.push(item.storageKey);
    byShard.set(item.shard, keys);
  }

  for (const [shard, keys] of byShard) {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      const xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n<Delete>` +
        batch
          .map((k) => `<Object><Key>${escapeXml(k)}</Key></Object>`)
          .join("") +
        `<Quiet>true</Quiet></Delete>`;
      const endpoint = process.env.R2_ENDPOINT!;
      const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
      const url = `${base}/${bucketForShard(shard)}?delete`;
      const res = await getClient().fetch(url, {
        method: "POST",
        body: xml,
        headers: { "Content-Type": "application/xml" },
      });
      if (!res.ok) {
        throw new Error(
          `R2 bulk delete failed on shard ${shard}: ${res.status} ${res.statusText}`,
        );
      }
    }
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
