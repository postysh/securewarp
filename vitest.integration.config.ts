import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["test/integration/**/*.integration.test.ts"],
    environment: "node",
    // Loads .env.test / .env.local in each worker process so the real
    // Supabase client picks up credentials.
    setupFiles: ["test/integration/setup.ts"],
    // Integration tests hit a real DB; network + Argon2 pushes individual
    // tests over the default 5s cap.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Serial by default. Supabase API rate limits, plus shared-state
    // tables (users, rate_limits) make parallel runs of auth tests
    // flaky. Per-file parallelism stays on so the file graph scales.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // server-only packages are fine in Node; no stub needed because
      // integration tests actually want the real server modules.
    },
  },
});
