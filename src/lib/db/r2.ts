import "server-only";
import { AwsClient } from "aws4fetch";

// Cloudflare Workers-compatible R2 client using aws4fetch (lightweight,
// Web-standard fetch-based signing). Replaces @aws-sdk/client-s3 which
// pulls in ~2MB of Node-only code and doesn't run on Workers.

const r2 = new AwsClient({
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  service: "s3",
  region: "auto",
});

const BUCKET = process.env.R2_BUCKET!;
const ENDPOINT = process.env.R2_ENDPOINT!;

function buildUrl(storageKey: string): string {
  // R2 endpoint is typically https://<account>.r2.cloudflarestorage.com
  // The bucket is a path segment, key is the rest of the path.
  const base = ENDPOINT.endsWith("/") ? ENDPOINT.slice(0, -1) : ENDPOINT;
  return `${base}/${BUCKET}/${encodeURIComponent(storageKey)}`;
}

/**
 * Generate a presigned URL for uploading an encrypted blob.
 * Client uploads directly to R2 — the server never touches the ciphertext.
 */
export async function getUploadUrl(storageKey: string): Promise<string> {
  const url = new URL(buildUrl(storageKey));
  // aws4fetch presigns by signing a URL with X-Amz-* query params.
  const signed = await r2.sign(
    new Request(url.toString(), { method: "PUT" }),
    { aws: { signQuery: true } }
  );
  // Override expires by setting X-Amz-Expires. aws4fetch default is 3600s;
  // we want 600s (10 min) to match the previous behavior.
  const u = new URL(signed.url);
  u.searchParams.set("X-Amz-Expires", "600");
  return u.toString();
}

/**
 * Generate a presigned URL for downloading an encrypted blob.
 */
export async function getDownloadUrl(storageKey: string): Promise<string> {
  const url = new URL(buildUrl(storageKey));
  const signed = await r2.sign(
    new Request(url.toString(), { method: "GET" }),
    { aws: { signQuery: true } }
  );
  const u = new URL(signed.url);
  u.searchParams.set("X-Amz-Expires", "600");
  return u.toString();
}

/**
 * Delete an encrypted blob from R2.
 */
export async function deleteBlob(storageKey: string): Promise<void> {
  const url = buildUrl(storageKey);
  const res = await r2.fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 delete failed: ${res.status} ${res.statusText}`);
  }
}
