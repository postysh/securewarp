import { NextResponse } from "next/server";
import { getSession, revokeAllSessions, createSession } from "@/lib/auth/session";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

/**
 * Revoke all sessions for the current user ("logout all devices").
 * Issues a fresh session for the current device so the caller
 * stays logged in.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await revokeAllSessions(session.userId);
    await createSession({ userId: session.userId, email: session.email }, request);

    auditEvent({ event: "auth.revoke_all", actorUserId: session.userId });
    return NextResponse.json({ success: true });
  } catch (err) {
    logError("auth.revoke-all", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
