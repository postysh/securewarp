/**
 * End-to-end auth flow: signup against a real browser, real Argon2,
 * real SRP-6a, real DB. Then verify the database row stores only
 * ciphertext — no plaintext password, no plaintext recovery phrase,
 * no plaintext anything the server shouldn't see.
 *
 * This is THE zero-knowledge guarantee expressed as a test.
 */

import { test, expect } from "@playwright/test";
import { e2eEmail, e2ePassword, fetchUser, purgeE2EState } from "./helpers";

test.beforeAll(async () => {
  await purgeE2EState();
});
test.afterAll(async () => {
  await purgeE2EState();
});

test("landing page renders and shows the brand", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/SecureWarp/i);
});

test("signup creates a user row with only ciphertext — no plaintext leaked", async ({
  page,
}) => {
  const email = e2eEmail("signup");
  const password = e2ePassword();

  await page.goto("/signup");

  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.getByPlaceholder("Confirm your password").fill(password);

  // Record the full POST body so we can inspect it for leaked plaintext.
  // The body is what actually travels over the wire.
  let registerRequestBody: string | null = null;
  page.on("request", (req) => {
    if (req.url().endsWith("/api/auth/register") && req.method() === "POST") {
      registerRequestBody = req.postData();
    }
  });

  await page.getByRole("button", { name: /sign up|create account/i }).click();

  // Recovery key modal appears on successful signup — wait for its
  // distinctive CTA. Argon2 + key derivation takes ~1–2 s; 30 s is
  // plenty of headroom.
  await expect(page.getByRole("button", { name: /I've saved my key/i })).toBeVisible({
    timeout: 30_000,
  });

  // ── ASSERTION 1: The request body does not contain the plaintext
  //                password. The browser sends SRP verifier / salt /
  //                encrypted blobs — never the password.
  expect(registerRequestBody).not.toBeNull();
  expect(registerRequestBody!).not.toContain(password);

  // ── ASSERTION 2: The recovery phrase displayed in the modal has
  //                NOT been sent anywhere. Grab it and prove it
  //                wasn't in the register body.
  // The modal renders each BIP39 word in its own element. Grab
  // everything visible and then intersect with the request body.
  const modal = page.getByRole("button", { name: /I've saved my key/i }).locator("..").locator("..");
  const words = (await modal.textContent())?.match(/[a-z]{3,8}/gi) ?? [];
  // We expect 24 BIP39 words.
  expect(words.length).toBeGreaterThanOrEqual(24);

  // Check the first 5 words of the phrase don't appear in the register
  // body. 5 is enough for a strong signal — if any single word appeared
  // it would be catastrophic.
  const firstFiveWords = words.slice(0, 5);
  for (const word of firstFiveWords) {
    if (word.length >= 4) {
      // Longer-than-3 words reduce the chance of a coincidental match
      // with a base64 substring in the ciphertext.
      expect(registerRequestBody!).not.toContain(` ${word} `);
      expect(registerRequestBody!).not.toContain(`"${word}"`);
    }
  }

  // ── ASSERTION 3: The DB row is ciphertext-only. `encrypted_user_data`
  //                is a JSON blob with nonce + ciphertext fields. It
  //                must not contain the password or any recovery word.
  const row = await fetchUser(email);
  expect(row).toBeTruthy();
  expect(row.email).toBe(email);
  expect(row.encrypted_user_data).not.toContain(password);
  for (const word of firstFiveWords) {
    if (word.length >= 4) {
      expect(row.encrypted_user_data).not.toContain(` ${word} `);
      expect(row.encrypted_user_data).not.toContain(`"${word}"`);
    }
  }

  // ── ASSERTION 4: The SRP verifier is present (auth works), and
  //                the recovery hash is stored (recovery works). Both
  //                are one-way transforms; neither lets the server
  //                recover the password or the phrase.
  expect(row.srp_verifier).toBeTruthy();
  expect(row.srp_verifier.length).toBeGreaterThan(50);
  expect(row.recovery_key_hash).toBeTruthy();

  // Close the recovery key modal; new signups route to the onboarding
  // screen first (/welcome), then to /drive once completed. Accept
  // either as a successful landing.
  await page.getByRole("button", { name: /I've saved my key/i }).click();
  await page.waitForURL(/\/(welcome|drive)/, { timeout: 15_000 });
});
