/**
 * Per-worker setup for integration tests. Loads .env.test then .env.local
 * into process.env before any test file imports app modules that read env.
 *
 * Using absolute paths so vitest workers (which may run from a different
 * cwd) still find the files. dotenv returns `{ parsed: {}, error: ENOENT }`
 * on missing files — truthy but empty — so we check `error` explicitly
 * before falling through to the backup path.
 */
import { config } from "dotenv";
import { resolve } from "node:path";

const root = resolve(__dirname, "..", "..");
const testFile = resolve(root, ".env.test");
const localFile = resolve(root, ".env.local");

const test = config({ path: testFile, quiet: true });
if (test.error || !test.parsed || Object.keys(test.parsed).length === 0) {
  config({ path: localFile, quiet: true });
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    `Integration test env missing. Checked ${testFile} then ${localFile}. ` +
      `SUPABASE_URL=${process.env.SUPABASE_URL ? "set" : "MISSING"}, ` +
      `SUPABASE_SERVICE_ROLE_KEY=${process.env.SUPABASE_SERVICE_ROLE_KEY ? "set" : "MISSING"}.`,
  );
}
