import "server-only";
import { Polar } from "@polar-sh/sdk";
import { polarConfig } from "./config";

/**
 * Singleton Polar SDK client. Created lazily on first use so
 * unit tests that don't touch billing don't need the env vars set.
 * `server: "production"` targets api.polar.sh — there is no separate
 * staging env; we chose not to use polar-sandbox because its OAuth
 * scope list diverged from production and caused auth failures.
 */
let _client: Polar | null = null;

export function polar(): Polar {
  if (_client) return _client;
  const { accessToken } = polarConfig();
  _client = new Polar({ accessToken, server: "production" });
  return _client;
}
