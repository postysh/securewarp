/**
 * Folder-metadata e2e. Proves filenames are encrypted at rest — the
 * server (and anyone who steals the DB) can NEVER read what the user
 * named their folder.
 *
 * This is the other half of the zero-knowledge guarantee: AGENTS.md
 * says "the server must never see ... plaintext filenames." This test
 * verifies that promise by creating a folder with a distinctive name,
 * then confirming the name does not appear anywhere in the row.
 */

import { test, expect } from "@playwright/test";
import {
  purgeE2EState,
  signUpAndLandOnDrive,
  fetchFilesForUser,
} from "./helpers";

test.beforeAll(async () => {
  await purgeE2EState();
});
test.afterAll(async () => {
  await purgeE2EState();
});

test("folder names are encrypted at rest", async ({ page }) => {
  const { email } = await signUpAndLandOnDrive(page, { tag: "folder" });

  // Distinctive plaintext name — any substring of it showing up in
  // the stored metadata would be a leak.
  const folderName = `sw-secret-folder-${Date.now()}-XYZ`;

  // Capture the POST /api/files/folder body so we can also assert the
  // HTTP request itself didn't leak the name.
  let folderCreateBody: string | null = null;
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      req.url().endsWith("/api/files/folder")
    ) {
      folderCreateBody = req.postData();
    }
  });

  // Open the New folder modal. The top-of-drive toolbar has a
  // "New folder" button.
  await page.getByRole("button", { name: /new folder/i }).first().click();

  // Fill the folder name and submit.
  await page.getByPlaceholder("Untitled folder").fill(folderName);
  await page.getByRole("button", { name: /^create$/i }).click();

  // Wait for the modal to dismiss (folder created).
  await expect(page.getByRole("dialog", { name: /new folder/i })).not.toBeVisible({
    timeout: 15_000,
  });

  // The folder appears in the tree with its decrypted name — proves
  // client-side decrypt works.
  await expect(page.getByText(folderName).first()).toBeVisible({
    timeout: 15_000,
  });

  // ── ASSERTION 1: The wire did not leak the plaintext folder name.
  //                The client encrypts before POST, so the body carries
  //                only ciphertext.
  expect(folderCreateBody).not.toBeNull();
  expect(folderCreateBody!).not.toContain(folderName);

  // ── ASSERTION 2: The DB row only holds ciphertext for the metadata.
  //                Even with full DB access, the folder's name is
  //                unreadable.
  const files = await fetchFilesForUser(email);
  const folderRow = files.find((f) => f.is_folder);
  expect(folderRow).toBeTruthy();
  expect(folderRow!.is_folder).toBe(true);
  expect(folderRow!.encrypted_metadata).toBeTruthy();
  expect(folderRow!.encrypted_metadata).not.toContain(folderName);

  // ── ASSERTION 3: The hierarchical crypto columns are all populated
  //                (no NULL shortcut). An attacker can't pick a
  //                metadata-only file and find a shortcut to the
  //                session key. Crypto v2 Phase 2b added the ML-KEM
  //                half; session_key_nonce is empty for v2 wraps
  //                (the hybrid blob embeds its own nonce) so we
  //                check the hybrid pair instead.
  expect(folderRow!.public_hierarchical_key).toBeTruthy();
  expect(folderRow!.public_kem_hierarchical_key).toBeTruthy();
  expect(folderRow!.encrypted_session_key_by_file).toBeTruthy();
});
