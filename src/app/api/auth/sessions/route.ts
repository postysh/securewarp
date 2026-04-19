import { NextResponse } from "next/server";
import { getSession, revokeAllSessionsExcept } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { auditEvent } from "@/lib/audit";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { logError } from "@/lib/log";

/**
 * GET /api/auth/sessions
 *
 * Returns the caller's own active sessions, filtered to
 * `user_id = session.userId`. The service-role client bypasses RLS
 * so the app-layer filter is load-bearing — never drop it.
 *
 * Returned shape (one entry per row):
 *   jti         — opaque session id. Already known to the client
 *                 that owns it (it's in their JWT), so returning it
 *                 is not a leak. Used as the DELETE key below.
 *   createdAt   — when the session was minted.
 *   lastSeenAt  — bumped at most once per minute on each getSession.
 *   userAgent   — raw UA string, capped at 512 chars at write time.
 *   country     — ISO-3166-1 alpha-2 or null.
 *   current     — true on the row whose jti matches the caller's JWT
 *                 so the UI can mark it "This device".
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Cheap per-user rate limit. The endpoint is read-only but
    // returns UA + country, so treating it as protected is the
    // defensive default.
    if (!(await checkRateLimit(`sessions-list:${session.userId}`, 60, 60 * 1000))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const { data, error } = await supabase
      .from("sessions")
      .select("jti, created_at, last_seen_at, user_agent, country, expires_at")
      .eq("user_id", session.userId)
      .gt("expires_at", new Date().toISOString())
      .order("last_seen_at", { ascending: false });
    if (error) {
      logError("auth.sessions.list", error);
      return NextResponse.json({ error: "Failed to load sessions" }, { status: 500 });
    }

    const rows = (data ?? []).map((r) => ({
      jti: r.jti as string,
      createdAt: r.created_at as string,
      lastSeenAt: r.last_seen_at as string,
      userAgent: (r.user_agent as string | null) ?? null,
      country: (r.country as string | null) ?? null,
      current: session.jti === r.jti,
    }));
    return NextResponse.json({ sessions: rows });
  } catch (err) {
    logError("auth.sessions.list", err);
    return NextResponse.json({ error: "Failed to load sessions" }, { status: 500 });
  }
}

/**
 * POST /api/auth/sessions
 * Action: "revoke-others" — revoke every session for this user
 * EXCEPT the caller's own. Keeps the caller signed in on this device.
 *
 * The existing /api/auth/revoke-all endpoint revokes everything
 * (including the caller's current session) then mints a new one,
 * which rotates the caller's JWT. This endpoint instead leaves the
 * current session untouched — no JWT rotation, no race with the
 * cookie Set-Cookie on return.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || !session.jti) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await checkRateLimit(`sessions-revoke:${session.userId}`, 10, 60 * 1000))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    let body: { action?: string } = {};
    try {
      body = (await request.json()) as { action?: string };
    } catch {
      // Empty body treated as action=revoke-others below.
    }
    const action = body.action ?? "revoke-others";
    if (action !== "revoke-others") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    await revokeAllSessionsExcept(session.userId, session.jti);
    auditEvent({
      event: "auth.sessions.revoke_others",
      actorUserId: session.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("auth.sessions.revoke-others", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
