import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { deleteBlob } from "@/lib/db/r2";
import { logError } from "@/lib/log";

const BodySchema = z.object({
  // Require the admin to type the target's email as a safety confirmation.
  // Prevents accidental deletion from a misclick.
  confirmEmail: z.string().min(1),
  reason: z.string().max(500).optional(),
});

/**
 * Hard-delete a user. Owner-only. Wipes:
 *   - all R2 blobs (files + chunks) owned by the user
 *   - the user row (cascades: files, file_keys, file_chunks, file_links,
 *     notifications, srp_sessions, sessions)
 *
 * Identical mechanics to `/api/auth/delete-account` (user-initiated), but
 * executed against another user. Can't delete yourself via this endpoint —
 * use the user-initiated flow if you want to delete your own account.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (ctx.role !== "owner") return NextResponse.json({ error: "Owner only" }, { status: 403 });

  try {
    const { id: targetId } = await params;
    if (targetId === ctx.userId) {
      return NextResponse.json({ error: "Use the account settings page to delete your own account" }, { status: 400 });
    }

    const body = await request.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const { data: target, error: fetchErr } = await supabase
      .from("users")
      .select("id, email, role")
      .eq("id", targetId)
      .single();
    if (fetchErr || !target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (parsed.data.confirmEmail !== target.email) {
      return NextResponse.json({ error: "Confirmation email did not match" }, { status: 400 });
    }

    // Collect R2 keys to delete after the DB cascade.
    const { data: files } = await supabase
      .from("files")
      .select("id, storage_key")
      .eq("owner_id", targetId);
    const fileIds = (files || []).map((f) => f.id);

    let chunkKeys: string[] = [];
    if (fileIds.length > 0) {
      const { data: chunks } = await supabase
        .from("file_chunks")
        .select("storage_key")
        .in("file_id", fileIds);
      chunkKeys = (chunks || []).map((c) => c.storage_key as string);
    }

    const allKeys = [
      ...(files || []).map((f) => f.storage_key as string | null).filter((k): k is string => !!k),
      ...chunkKeys,
    ];

    // Delete DB row first (cascades). R2 cleanup is best-effort afterwards.
    const { error: delErr } = await supabase.from("users").delete().eq("id", targetId);
    if (delErr) throw delErr;

    // Log BEFORE R2 cleanup in case the blob deletes take a while.
    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "user.delete",
      targetUserId: targetId,
      detail: `email=${target.email} blobs=${allKeys.length} reason=${parsed.data.reason ?? ""}`,
    });

    // R2 cleanup — best-effort. If a blob fails, nightly cleanup will sweep
    // it as orphaned (its DB row is gone).
    await Promise.all(
      allKeys.map(async (key) => {
        try {
          await deleteBlob(key);
        } catch (err) {
          logError("admin.users.delete.r2", err);
        }
      })
    );

    return NextResponse.json({ success: true, blobsDeleted: allKeys.length });
  } catch (err) {
    logError("admin.users.delete", err);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
