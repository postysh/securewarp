/**
 * Playwright e2e helpers. Thin layer on top of the integration
 * helpers — same test-user prefix + cleanup pattern, but adapted
 * for browser-driven flows.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";

const TEST_TAG = "sw-e2e";

export function getServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Playwright requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.test.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Fresh test email — prefixed so teardown can sweep by LIKE. */
export function e2eEmail(tag = "user"): string {
  const rand = randomBytes(6).toString("hex");
  return `${TEST_TAG}-${tag}-${Date.now()}-${rand}@securewarp.test`;
}

/** Strong test password — 8+ chars with mixed shape. */
export function e2ePassword(): string {
  return `P4ss-${randomBytes(8).toString("hex")}`;
}

/**
 * Purge every test user + their cascaded rows + rate-limit buckets.
 * Clears test-user rows, all register:* and login:* rate limits
 * (safe — this DB is test-only), and any bucket referencing the
 * test tag. Call before + after every spec so a hostile leftover
 * can't rate-limit the next run.
 */
export async function purgeE2EState(): Promise<void> {
  const sb = getServiceClient();
  await sb.from("users").delete().like("email", `${TEST_TAG}-%`);
  // The register / login rate-limit keys are IP-based (register:1.2.3.4)
  // and email-based (login:foo@bar). On the test DB there are no real
  // users, so wiping both families wholesale is safe and ensures a
  // fresh bucket for the next run regardless of workers/retries.
  await sb.from("rate_limits").delete().like("key", "register:%");
  await sb.from("rate_limits").delete().like("key", "login:%");
  await sb.from("rate_limits").delete().like("key", `%${TEST_TAG}%`);
}

/** Fetch a stored user row by email (post-signup assertions). */
export async function fetchUser(email: string) {
  const sb = getServiceClient();
  const { data } = await sb.from("users").select("*").eq("email", email).single();
  return data;
}

/** Fetch every non-workspace-root file row owned by a user. */
export async function fetchFilesForUser(email: string) {
  const sb = getServiceClient();
  const { data: user } = await sb.from("users").select("id").eq("email", email).single();
  if (!user) return [];
  const { data } = await sb
    .from("files")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });
  return data ?? [];
}

/**
 * Drive-in-one: register, accept the recovery key, skip the onboarding
 * wizard, land on /drive. Returns the account credentials so callers
 * can log in again later (for the login round-trip test).
 */
export async function signUpAndLandOnDrive(
  page: Page,
  opts?: { tag?: string },
): Promise<{ email: string; password: string }> {
  const email = e2eEmail(opts?.tag);
  const password = e2ePassword();

  await page.goto("/signup");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("Enter your password").fill(password);
  await page.getByPlaceholder("Confirm your password").fill(password);
  await page.getByRole("button", { name: /sign up|create account/i }).click();

  // Recovery-key modal — accept.
  await page
    .getByRole("button", { name: /I've saved my key/i })
    .click({ timeout: 30_000 });

  // Onboarding wizard: Skip name, skip workspace, land on /drive.
  await page
    .getByRole("button", { name: /Skip for now/i })
    .click({ timeout: 15_000 });
  await page
    .getByRole("button", { name: /Skip, I'll do this later/i })
    .click({ timeout: 15_000 });
  await page.waitForURL(/\/drive/, { timeout: 15_000 });

  return { email, password };
}
