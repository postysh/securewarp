import { defineConfig } from "@playwright/test";
import { config } from "dotenv";
import { resolve } from "node:path";

// Load .env.test so the Next.js dev server started below runs against
// the isolated test Supabase project, never prod. `.env.test` is
// gitignored; see the harness setup for the values it expects.
const loaded = config({ path: resolve(__dirname, ".env.test"), quiet: true });
if (loaded.error) {
  throw new Error(
    `Playwright requires .env.test — ${loaded.error.message}. ` +
      `See vitest.integration.config.ts for the setup.`,
  );
}

// The subset of env vars the dev server inherits. Only things the app
// actually reads at runtime — don't leak prod secrets by accident.
const WEB_SERVER_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL ?? "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  SESSION_SECRET: process.env.SESSION_SECRET ?? "",
  // Test R2 bucket (`securewarp-test`). Token is scoped to this
  // bucket only — can't touch prod. See .env.test for the scope.
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? "",
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? "",
  R2_ENDPOINT: process.env.R2_ENDPOINT ?? "",
  R2_BUCKET: process.env.R2_BUCKET ?? "",
  // Mute Turnstile + Sentry + email during tests.
  TURNSTILE_SECRET_KEY: "",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
  RESEND_API_KEY: "",
  NEXT_PUBLIC_SENTRY_DSN: "",
  // Marker that downstream code can check if it ever needs to.
  SECUREWARP_E2E: "1",
} as const;

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false, // auth flow shares rate-limit buckets per email
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: WEB_SERVER_ENV,
    stdout: "pipe",
    stderr: "pipe",
  },
});
