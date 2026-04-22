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

function buildUrl(storageKey: string): string {
  const endpoint = process.env.R2_ENDPOINT!;
  const bucket = process.env.R2_BUCKET!;
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
 * Generate a presigned URL for uploading an encrypted blob.
 * Client uploads directly to R2 — the server never touches the ciphertext.
 */
export async function getUploadUrl(storageKey: string): Promise<string> {
  // Pre-set X-Amz-Expires BEFORE signing. It's part of the canonical
  // query string, so mutating it after sign() invalidates the signature.
  // aws4fetch defaults to 3600s if we don't specify.
  const url = new URL(buildUrl(storageKey));
  url.searchParams.set("X-Amz-Expires", PRESIGNED_URL_TTL_SECONDS);
  const signed = await getClient().sign(
    new Request(url.toString(), { method: "PUT" }),
    { aws: { signQuery: true } }
  );
  return signed.url;
}

/**
 * Generate a presigned URL for downloading an encrypted blob.
 */
export async function getDownloadUrl(storageKey: string): Promise<string> {
  const url = new URL(buildUrl(storageKey));
  url.searchParams.set("X-Amz-Expires", PRESIGNED_URL_TTL_SECONDS);
  const signed = await getClient().sign(
    new Request(url.toString(), { method: "GET" }),
    { aws: { signQuery: true } }
  );
  return signed.url;
}

/**
 * Delete an encrypted blob from R2.
 */
export async function deleteBlob(storageKey: string): Promise<void> {
  const url = buildUrl(storageKey);
  const res = await getClient().fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 delete failed: ${res.status} ${res.statusText}`);
  }
}
