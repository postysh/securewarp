/**
 * JWT session management using jose.
 * Creates/verifies signed JWTs stored in HttpOnly cookies.
 * Sessions are tracked in a DB table for revocation support + the
 * Active Sessions UI in Settings → Security (see /api/auth/sessions).
 */

import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { supabase } from "@/lib/db/supabase";

const SESSION_COOKIE = "securewarp_session";
const SESSION_EXPIRY = "7d";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds
// Throttle how often getSession bumps last_seen_at. Under the
// threshold we skip the UPDATE so the request path doesn't grow an
// extra write on every authenticated API call. 60 s is plenty of
// granularity for "Last active N minutes/hours ago" UI.
const LAST_SEEN_BUMP_INTERVAL_MS = 60 * 1000;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  email: string;
}

/**
 * Parse the request headers the session lifecycle cares about.
 * Both values are already observable by Cloudflare + Supabase logs
 * on every request, so storing them on the session row adds no new
 * PII exposure — it just makes the same data visible to the user
 * whose session it is.
 *
 * Outputs are defensively normalised:
 *   - user_agent is capped at 512 chars to stop a malicious client
 *     from stuffing the column with a multi-KB string.
 *   - country is upper-cased and must match /^[A-Z]{2}$/ (valid
 *     ISO-3166-1 alpha-2); anything else becomes null so we don't
 *     render garbage in the UI.
 */
function extractSessionContext(request: Request): {
  userAgent: string | null;
  country: string | null;
} {
  const ua = request.headers.get("user-agent");
  const cfCountry = request.headers.get("cf-ipcountry");
  const trimmedUa = ua ? ua.slice(0, 512) : null;
  const normalisedCountry = cfCountry
    ? cfCountry.toUpperCase().trim()
    : null;
  const country =
    normalisedCountry && /^[A-Z]{2}$/.test(normalisedCountry)
      ? normalisedCountry
      : null;
  return { userAgent: trimmedUa, country };
}

export async function createSession(
  payload: SessionPayload,
  request: Request,
): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);
  const ctx = extractSessionContext(request);

  // Prune the caller's prior session on this device before minting
  // a new one. Without this step every re-login on the same device
  // (cookie-expired reuse, a second tab signing in, a password
  // change without the explicit revoke-all path, ...) would leave
  // the old row behind and the Active Sessions UI would accumulate
  // orphan "devices" that aren't actually signed in anywhere.
  //
  // Best-effort: a malformed/expired JWT just falls through the
  // catch, so we don't block fresh logins on a broken old cookie.
  // jti is whatever the cookie says — the service-role client can
  // delete any row, but the delete is no-op if it doesn't match an
  // existing jti, so a forged cookie (crypto-invalid) never lands
  // here anyway (jwtVerify would throw first).
  try {
    const cookieStore = await cookies();
    const existingToken = cookieStore.get(SESSION_COOKIE)?.value;
    if (existingToken) {
      const { payload: existing } = await jwtVerify(existingToken, getSecret());
      const existingJti = existing.jti as string | undefined;
      if (existingJti) {
        await supabase.from("sessions").delete().eq("jti", existingJti);
      }
    }
  } catch {
    // Cookie missing, invalid, or expired — nothing to prune.
  }

  // Create a session record with a unique jti for revocation.
  // `created_at`, `last_seen_at` default to now() at the DB level.
  const { data: session, error } = await supabase
    .from("sessions")
    .insert({
      user_id: payload.userId,
      expires_at: expiresAt.toISOString(),
      user_agent: ctx.userAgent,
      country: ctx.country,
    })
    .select("jti")
    .single();
  if (error) throw new Error(`Failed to create session: ${error.message}`);

  const token = await new SignJWT({ ...payload, jti: session.jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_EXPIRY)
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/**
 * Fire-and-forget last_seen_at bump. Throttled to once per
 * LAST_SEEN_BUMP_INTERVAL_MS via a WHERE clause on last_seen_at —
 * zero rows touched if recent enough, so the common path is a
 * single no-op UPDATE round-trip.
 */
async function bumpLastSeen(jti: string): Promise<void> {
  const cutoff = new Date(Date.now() - LAST_SEEN_BUMP_INTERVAL_MS).toISOString();
  // Best-effort: swallow failures so a stale schema or transient
  // DB hiccup doesn't interrupt the request.
  try {
    await supabase
      .from("sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("jti", jti)
      .lt("last_seen_at", cutoff);
  } catch {
    // ignore
  }
}

export interface SessionExtras {
  jti?: string;
}

export async function getSession(): Promise<(SessionPayload & SessionExtras) | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret());
    const jti = payload.jti as string | undefined;
    const userId = payload.userId as string;

    // Verify the session hasn't been revoked AND the user isn't suspended.
    // Suspending a user doesn't immediately delete their sessions — this
    // check makes the ban effective on the next request regardless of how
    // many active JWTs they hold.
    if (jti) {
      const [{ data: sess }, { data: user }] = await Promise.all([
        supabase.from("sessions").select("jti").eq("jti", jti).single(),
        supabase.from("users").select("suspended_at").eq("id", userId).single(),
      ]);
      if (!sess) return null; // Session was revoked
      if (user?.suspended_at) return null; // User is suspended
      // Fire-and-forget — don't await so the request isn't slowed
      // by the write. `void` suppresses the floating-promise lint.
      void bumpLastSeen(jti);
    }

    return {
      userId,
      email: payload.email as string,
      jti,
    };
  } catch {
    return null;
  }
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  // Revoke the session in the DB
  if (token) {
    try {
      const { payload } = await jwtVerify(token, getSecret());
      if (payload.jti) {
        await supabase.from("sessions").delete().eq("jti", payload.jti as string);
      }
    } catch {
      // Token invalid — nothing to revoke
    }
  }

  cookieStore.delete(SESSION_COOKIE);
}

/**
 * Revoke ALL sessions for a user. Used by "logout all devices"
 * and password change flows.
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  await supabase.from("sessions").delete().eq("user_id", userId);
}

/**
 * Revoke every session for a user EXCEPT the one identified by
 * `exceptJti`. Used by the Settings → Active sessions "Sign out
 * of all other devices" action so the caller doesn't bounce
 * themselves back to /login.
 */
export async function revokeAllSessionsExcept(
  userId: string,
  exceptJti: string,
): Promise<void> {
  await supabase
    .from("sessions")
    .delete()
    .eq("user_id", userId)
    .neq("jti", exceptJti);
}
