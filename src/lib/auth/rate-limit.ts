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
    // Fail open on DB errors so an outage doesn't lock every user out of
    // login. Rate limiting is defense-in-depth; auth is still gated by SRP.
    console.error("Rate limit RPC failed:", error.message);
    return true;
  }

  return data === true;
}
