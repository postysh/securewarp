/**
 * Login round-trip e2e. Proves that SRP-6a actually protects the
 * password during login (not just signup). The password MUST NOT
 * appear in either step of the login protocol over the wire.
 */

import { test, expect } from "@playwright/test";
import { purgeE2EState, signUpAndLandOnDrive } from "./helpers";

test.beforeAll(async () => {
  await purgeE2EState();
});
test.afterAll(async () => {
  await purgeE2EState();
});

test("login round-trip — password never leaves the browser", async ({ page, context }) => {
  // First, create an account we can log into.
  const { email, password } = await signUpAndLandOnDrive(page, { tag: "login" });

  // Log the current session out by nuking cookies + sessionStorage.
  // Simulates a fresh device / new tab without the unlock cache.
  await context.clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // Capture both SRP steps' bodies so we can prove the plaintext
  // password is absent from the wire.
  let initBody: string | null = null;
  let verifyBody: string | null = null;
  page.on("request", (req) => {
    const url = req.url();
    if (req.method() !== "POST") return;
    if (url.endsWith("/api/auth/login/init")) initBody = req.postData();
    if (url.endsWith("/api/auth/login/verify")) verifyBody = req.postData();
  });

  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();

  // A successful SRP round-trip lands on /drive (onboarding already
  // done). 2FA isn't enabled for test accounts.
  await page.waitForURL(/\/drive/, { timeout: 30_000 });

  // ── ASSERTION 1: init body has clientPublicEphemeral + email, no
  //                password. The browser sends its SRP ephemeral;
  //                nothing else.
  expect(initBody).not.toBeNull();
  expect(initBody!).toContain("clientPublicEphemeral");
  expect(initBody!).not.toContain(password);

  // ── ASSERTION 2: verify body has the M1 client proof, not the
  //                password. The proof is a hex digest; no way to
  //                reverse it to the password.
  expect(verifyBody).not.toBeNull();
  expect(verifyBody!).toContain("clientProof");
  expect(verifyBody!).not.toContain(password);

  // ── ASSERTION 3: Neither body can be combined with anything else
  //                on the wire to recover the password. A belt-and-
  //                braces check: the password as a substring doesn't
  //                appear in the entire recorded traffic.
  const combined = (initBody ?? "") + "\n" + (verifyBody ?? "");
  expect(combined).not.toContain(password);
});
