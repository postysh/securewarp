import { NextResponse } from "next/server";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Revoke one session for a user (by jti). Handy for "user reports their
 * laptop was stolen, kill that one device." Does not touch other active
 * sessions. The next request carrying the revoked JWT will be rejected
 * because getSession() verifies the jti row still exists.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; jti: string }> }
) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: userId, jti } = await params;

    const { error, count } = await supabase
      .from("sessions")
      .delete({ count: "exact" })
      .eq("jti", jti)
      .eq("user_id", userId);
    if (error) throw error;
    if (!count) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "session.revoke",
      targetUserId: userId,
      detail: `jti=${jti}`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("admin.sessions.revoke", err);
    return NextResponse.json({ error: "Failed to revoke session" }, { status: 500 });
  }
}
