import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { revokeAllSessions } from "@/lib/auth/session";
import { logError } from "@/lib/log";

const BodySchema = z.object({
  reason: z.string().max(500).optional(),
});

/**
 * Suspend a user. Sets `suspended_at = now()` and revokes all their active
 * sessions so the ban is immediate, not "next page load." Admins can suspend
 * users; only owners can suspend admins. Nobody can suspend themselves or
 * another owner (avoids lockout / privilege-inversion mistakes).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: targetId } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    if (targetId === ctx.userId) {
      return NextResponse.json({ error: "Cannot suspend yourself" }, { status: 400 });
    }

    const { data: target, error: fetchErr } = await supabase
      .from("users")
      .select("role")
      .eq("id", targetId)
      .single();
    if (fetchErr || !target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (target.role === "owner") {
      return NextResponse.json({ error: "Cannot suspend an owner" }, { status: 403 });
    }
    if (target.role === "admin" && ctx.role !== "owner") {
      return NextResponse.json({ error: "Only an owner can suspend an admin" }, { status: 403 });
    }

    const { error: updErr } = await supabase
      .from("users")
      .update({
        suspended_at: new Date().toISOString(),
        suspended_reason: parsed.data.reason ?? null,
      })
      .eq("id", targetId);
    if (updErr) throw updErr;

    // Kick them out everywhere
    await revokeAllSessions(targetId);

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "user.suspend",
      targetUserId: targetId,
      detail: parsed.data.reason ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("admin.users.suspend", err);
    return NextResponse.json({ error: "Failed to suspend user" }, { status: 500 });
  }
}
