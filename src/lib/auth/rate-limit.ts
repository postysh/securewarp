import "server-only";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Distributed rate limiter backed by Postgres via the `check_rate_limit` RPC
 * (see README migrations). Atomically increments or resets the counter in a
 * single statement so concurrent requests cannot slip past the limit.
 */
export async function checkRateLimit(
  key: string,
  maxAttempts: number = 10,
  windowMs: number = 60 * 60 * 1000 // 1 hour
): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_key: key,
    p_max: maxAttempts,
    p_window_ms: windowMs,
  });

  if (error) {
    // Fail closed. An attacker who can reliably trigger transient DB
    // errors (network jitter, coordinated load) would otherwise slip
    // past rate limits entirely. SRP-6a bounds the damage of online
    // guessing attempts, but rate limiting is still the primary defence
    // against password spraying and recovery-token enumeration; losing
    // it wholesale during an outage is worse than a brief login outage
    // that forces the operator to investigate.
    logError("rate-limit.check", new Error(error.message));
    return false;
  }

  return data === true;
}

/**
 * Reset a rate-limit counter. Call after a successful auth event
 * (login verify, recovery) so genuine users never burn their bucket.
 * The limiter's purpose is spraying + online guessing defence —
 * both of which are by definition failed attempts, so counting
 * successes against the budget only punishes legitimate users.
 *
 * Silent on error — this is a nice-to-have; failing the request
 * because we couldn't delete a row would be worse than keeping the
 * stale count.
 */
export async function resetRateLimit(key: string): Promise<void> {
  const { error } = await supabase
    .from("rate_limits")
    .delete()
    .eq("key", key);
  if (error) {
    logError("rate-limit.reset", new Error(error.message));
  }
}
