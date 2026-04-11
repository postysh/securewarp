import "server-only";
import { logError } from "../log";

/**
 * Cloudflare Turnstile verification.
 *
 * This helper is deliberately a no-op when `TURNSTILE_SECRET_KEY` is
 * unset in the environment — that lets us ship the server-side
 * verification path before the Cloudflare widget and site key are
 * provisioned, so auth routes keep working. Once the operator sets the
 * env var, verification becomes mandatory automatically without a code
 * change or deploy.
 *
 * When enabled, every auth-sensitive request (register, login,
 * recovery) MUST include a valid `cf-turnstile-response` token from
 * the client-side widget. The server posts that token plus the secret
 * key to Cloudflare's siteverify endpoint and rejects the request if
 * the token isn't valid or is reused.
 */

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileVerification {
  ok: boolean;
  // One of "required" (env set + token missing), "invalid" (Cloudflare
  // rejected), "skipped" (env unset, no-op mode), or "ok".
  reason: "ok" | "skipped" | "required" | "invalid";
}

/**
 * Verify a Turnstile token. `request` is used to pull the client's
 * forwarded IP for improved scoring (Cloudflare binds tokens to the
 * IP that produced them).
 */
export async function verifyTurnstile(
  token: string | undefined,
  request: Request
): Promise<TurnstileVerification> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // No secret provisioned — the env var acts as a feature flag.
    return { ok: true, reason: "skipped" };
  }

  if (!token) {
    return { ok: false, reason: "required" };
  }

  try {
    const ip =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-vercel-forwarded-for") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.append("remoteip", ip);

    const res = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = (await res.json()) as { success: boolean; "error-codes"?: string[] };
    if (data.success) return { ok: true, reason: "ok" };
    logError("turnstile.verify", { codes: data["error-codes"] });
    return { ok: false, reason: "invalid" };
  } catch (err) {
    logError("turnstile.verify", err);
    // Fail closed: if the siteverify endpoint is unreachable and the
    // secret IS provisioned, reject the request rather than silently
    // letting it through. Matches the rate-limiter fail-closed posture.
    return { ok: false, reason: "invalid" };
  }
}
