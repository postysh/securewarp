import "server-only";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Feature flag catalog. Adding a new flag:
 *   1. Add a key + default + description here.
 *   2. Ship a migration that `INSERT ... ON CONFLICT DO NOTHING` seeds
 *      the row (or do it once in the Supabase SQL editor).
 *   3. Call `getBoolFlag("my_flag")` from the code that gates on it.
 *   4. The admin UI at /admin/flags renders everything in app_settings
 *      automatically, so nothing to wire up there.
 *
 * Defaults live in code, not the DB, so a missing DB row gracefully
 * falls back instead of turning a critical path off.
 */
export interface FlagDef {
  key: string;
  defaultValue: boolean;
  description: string;
}

export const BOOL_FLAGS: FlagDef[] = [
  {
    key: "signups_enabled",
    defaultValue: true,
    description:
      "When off, /api/auth/register returns 503. Blocks new account creation without kicking out existing users.",
  },
  {
    key: "uploads_enabled",
    defaultValue: true,
    description:
      "When off, /api/files/chunk-upload returns 503. Users can still log in and browse their existing files; new uploads are blocked.",
  },
];

/**
 * Read a boolean flag. Falls back to the catalog's default if:
 *   - the row doesn't exist
 *   - the DB call errors (fail open for optional features, fail closed
 *     is not always the right call for a feature flag — the default is
 *     what the code expects under normal operation)
 */
export async function getBoolFlag(key: string): Promise<boolean> {
  const def = BOOL_FLAGS.find((f) => f.key === key);
  const fallback = def?.defaultValue ?? false;

  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .single();
    if (error) {
      // PGRST116 = no rows — expected if the seed wasn't run. Fall back
      // silently; log anything else.
      if (error.code !== "PGRST116") logError("flags.read", { key, error: error.message });
      return fallback;
    }
    return data.value === "true";
  } catch (err) {
    logError("flags.read", { key, err });
    return fallback;
  }
}
