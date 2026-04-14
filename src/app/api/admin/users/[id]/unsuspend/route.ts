import { NextResponse } from "next/server";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Lift a suspension. Clears `suspended_at` and `suspended_reason`. User can
 * immediately log in again (existing cached sessions are gone from the
 * suspend step). Any admin can unsuspend any non-owner user.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: targetId } = await params;

    const { error } = await supabase
      .from("users")
      .update({ suspended_at: null, suspended_reason: null })
      .eq("id", targetId);
    if (error) throw error;

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "user.unsuspend",
      targetUserId: targetId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("admin.users.unsuspend", err);
    return NextResponse.json({ error: "Failed to unsuspend user" }, { status: 500 });
  }
}
