import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const BodySchema = z.object({
  role: z.enum(["user", "admin", "owner"]),
});

/**
 * Change a user's role. Only owners can change roles at all — admins can
 * suspend but not promote. Extra guard: you can't demote the last owner,
 * and you can't change your own role (avoids accidental lockout).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (ctx.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });

  try {
    const { id: targetId } = await params;
    const body = await request.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid role" }, { status: 400 });

    if (targetId === ctx.userId) {
      return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
    }

    // If demoting an owner, verify we won't leave zero owners in the system.
    const { data: target, error: fetchErr } = await supabase
      .from("users")
      .select("role")
      .eq("id", targetId)
      .single();
    if (fetchErr || !target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (target.role === "owner" && parsed.data.role !== "owner") {
      const { count } = await supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("role", "owner");
      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: "Cannot demote the last owner" }, { status: 400 });
      }
    }

    const { error } = await supabase
      .from("users")
      .update({ role: parsed.data.role })
      .eq("id", targetId);
    if (error) throw error;

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "user.role_change",
      targetUserId: targetId,
      detail: `${target.role} → ${parsed.data.role}`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("admin.users.role", err);
    return NextResponse.json({ error: "Failed to change role" }, { status: 500 });
  }
}
