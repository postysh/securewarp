import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { auditEvent } from "@/lib/audit";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { logError } from "@/lib/log";

// Must match the cookie name set by createSession(). Duplicated
// here because session.ts scopes it privately; refactoring to
// export it is noise for a one-line DELETE.
const SESSION_COOKIE = "securewarp_session";

/**
 * DELETE /api/auth/sessions/[jti]
 *
 * Revoke one specific session. Ownership enforced at the app layer
 * by matching `user_id = session.userId` in the DELETE WHERE clause
 * — the service-role client bypasses RLS, so this filter is the
 * only thing stopping a caller from revoking someone else's session
 * by jti guess. Must stay on the DELETE itself (not a prior SELECT
 * + conditional DELETE) to avoid TOCTOU.
 */
const ParamSchema = z.object({ jti: z.string().uuid() });

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ jti: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jti: rawJti } = await params;
    const parsed = ParamSchema.safeParse({ jti: rawJti });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }
    const jti = parsed.data.jti;

    if (!(await checkRateLimit(`sessions-revoke:${session.userId}`, 30, 60 * 1000))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // Ownership is enforced in the WHERE clause. .delete() returns
    // the deleted rows via select() so we can tell whether a row
    // was actually removed — a 0-row delete with valid input means
    // the jti either doesn't exist or belongs to someone else;
    // both collapse to 404 so we don't leak which.
    const { data, error } = await supabase
      .from("sessions")
      .delete()
      .eq("jti", jti)
      .eq("user_id", session.userId)
      .select("jti");
    if (error) {
      logError("auth.sessions.revoke", error);
      return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const wasSelf = jti === session.jti;

    // If the caller revoked their OWN current session, also clear
    // the JWT cookie. Otherwise the cookie stays cryptographically
    // valid, middleware (which only does crypto verify, not a DB
    // check) keeps letting the browser past /login, and the client
    // bounces back to /drive where every server-side getSession()
    // returns null → UI shows "Unauthorized" in a loop. Clearing
    // the cookie here is what makes window.location.href = "/login"
    // actually land.
    if (wasSelf) {
      const cookieStore = await cookies();
      cookieStore.delete(SESSION_COOKIE);
    }

    auditEvent({
      event: "auth.sessions.revoke",
      actorUserId: session.userId,
      detail: wasSelf ? "self" : "other",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("auth.sessions.revoke", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
