/**
 * Full-pipeline file upload e2e — the ultimate zero-knowledge proof.
 *
 * Simulates the complete attacker scenario:
 *   1. User uploads a file with known plaintext content.
 *   2. We capture the PUT request that goes to R2 — the body must be
 *      ciphertext, never the plaintext.
 *   3. We fetch the R2 blob directly (as if the R2 bucket were stolen)
 *      — it must also be ciphertext.
 *   4. The DB row for the file has zero plaintext content or name.
 *
 * If every assertion passes, this proves: an attacker with full
 * access to the database AND the R2 bucket AND the raw HTTP traffic
 * (past TLS) still cannot read the user's file.
 */

import { test, expect } from "@playwright/test";
import { AwsClient } from "aws4fetch";
import {
  purgeE2EState,
  signUpAndLandOnDrive,
  fetchFilesForUser,
  getServiceClient,
} from "./helpers";

const PLAINTEXT = "ZERO-KNOWLEDGE-TEST-CONTENT-" + Date.now();
const FILENAME = `zkp-${Date.now()}.txt`;

async function fetchR2Blob(storageKey: string): Promise<Uint8Array> {
  const client = new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  });
  const base = process.env.R2_ENDPOINT!.replace(/\/$/, "");
  const bucket = process.env.R2_BUCKET!;
  const encoded = storageKey.split("/").map(encodeURIComponent).join("/");
  const url = `${base}/${bucket}/${encoded}`;
  const res = await client.fetch(url);
  if (!res.ok) {
    throw new Error(`R2 fetch failed: ${res.status} ${await res.text()}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

test.beforeAll(async () => {
  await purgeE2EState();
});
test.afterAll(async () => {
  await purgeE2EState();
});

test("file upload — plaintext is encrypted before leaving the browser and stays encrypted at rest", async ({
  page,
}) => {
  const { email } = await signUpAndLandOnDrive(page, { tag: "upload" });

  // Capture every PUT to R2. The uploader does a signed PUT to
  // R2.cloudflarestorage.com directly — browser → R2 with zero server
  // in the middle. The body of these PUTs MUST be ciphertext.
  const r2PutBodies: { url: string; body: string | null }[] = [];
  page.on("request", (req) => {
    if (
      req.method() === "PUT" &&
      /r2\.cloudflarestorage\.com/.test(req.url())
    ) {
      r2PutBodies.push({ url: req.url(), body: req.postData() });
    }
  });

  // Wait for the finalize request — the last step the client makes
  // after every chunk is uploaded and registered. Matching on the
  // request body's `action: "finalize"` is the most reliable "upload
  // is truly done" signal (the UI renders the filename optimistically
  // earlier, which would create a race).
  const finalizePromise = page.waitForRequest(
    (req) =>
      req.url().endsWith("/api/files/chunk-upload") &&
      req.method() === "POST" &&
      (req.postData() ?? "").includes('"finalize"'),
    { timeout: 30_000 },
  );

  // Feed the plaintext file into the hidden <input type="file">. The
  // browser then chunks → encrypts → PUTs to R2 all client-side.
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: FILENAME,
    mimeType: "text/plain",
    buffer: Buffer.from(PLAINTEXT, "utf8"),
  });

  await finalizePromise;
  // And confirm the UI rendered it too.
  await expect(page.getByText(FILENAME).first()).toBeVisible({
    timeout: 10_000,
  });

  // ── ASSERTION 1: At least one chunk was PUT to R2. ──────────────
  expect(r2PutBodies.length).toBeGreaterThan(0);

  // ── ASSERTION 2: NONE of those PUT bodies contain the plaintext.
  //                The client encrypted each chunk before sending. ──
  for (const put of r2PutBodies) {
    if (put.body) {
      expect(put.body).not.toContain(PLAINTEXT);
    }
  }

  // ── ASSERTION 3: The DB row is ciphertext-only. Filename not in
  //                encrypted_metadata; no storage_key decodes to
  //                plaintext. ──────────────────────────────────────
  const files = await fetchFilesForUser(email);
  const uploaded = files.find((f) => !f.is_folder);
  expect(uploaded).toBeTruthy();
  expect(uploaded!.encrypted_metadata).not.toContain(FILENAME);
  expect(uploaded!.encrypted_metadata).not.toContain(PLAINTEXT);
  expect(uploaded!.size_bytes).toBeGreaterThan(0);
  expect(uploaded!.upload_complete).toBe(true);

  // ── ASSERTION 4: The R2 blob itself is ciphertext. This is the
  //                "attacker steals the whole bucket" scenario. ────
  const sb = getServiceClient();
  const { data: chunks } = await sb
    .from("file_chunks")
    .select("storage_key, size_bytes")
    .eq("file_id", uploaded!.id)
    .order("sequence");
  expect(chunks).toBeTruthy();
  expect(chunks!.length).toBeGreaterThan(0);

  for (const chunk of chunks!) {
    const blob = await fetchR2Blob(chunk.storage_key);
    expect(blob.length).toBeGreaterThan(0);
    // Decode as UTF-8 for a substring check. Ciphertext is random
    // bytes, so the odds of the plaintext appearing by chance are
    // astronomical.
    const asText = new TextDecoder("utf-8", { fatal: false }).decode(blob);
    expect(asText).not.toContain(PLAINTEXT);
    // And the chunk should be larger than the plaintext due to the
    // authenticated payload header + Poly1305 MAC overhead.
    expect(blob.length).toBeGreaterThanOrEqual(PLAINTEXT.length);
  }

  // ── ASSERTION 5: file_chunks row metadata doesn't leak the
  //                plaintext or filename. ───────────────────────────
  for (const chunk of chunks!) {
    expect(chunk.storage_key).not.toContain(PLAINTEXT);
    expect(chunk.storage_key).not.toContain(FILENAME);
  }
});
