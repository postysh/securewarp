import "server-only";
import { supabase } from "@/lib/db/supabase";

/**
 * Atomically record a recovery token JTI as consumed. Returns true if this
 * is the first consumption (valid), false if the JTI was already used
 * (replay attempt). Backed by a Postgres PK to survive cold starts.
 */
export async function consumeRecoveryToken(
  jti: string,
  expiresAt: Date
): Promise<boolean> {
  const { error } = await supabase
    .from("used_recovery_tokens")
    .insert({ jti, expires_at: expiresAt.toISOString() });

  if (error) {
    // 23505 = unique_violation → JTI already consumed → replay
    if (error.code === "23505") return false;
    throw error;
  }
  return true;
}
