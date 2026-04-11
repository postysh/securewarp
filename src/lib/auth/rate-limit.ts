import "server-only";
import { supabase } from "@/lib/db/supabase";

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
    console.error("Rate limit RPC failed (failing closed):", error.message);
    return false;
  }

  return data === true;
}
