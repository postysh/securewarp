import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { deleteBlobs } from "@/lib/db/r2";
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
 *   - the user row, which cascades to:
 *       files (owner_id), file_keys (user_id), file_chunks (via files),
 *       file_links (created_by + via files), notifications (user_id,
 *       actor_user_id SET NULL), sessions, srp_sessions, workspace_members,
 *       workspaces (owner_id → cascades the workspace root folder too).
 *   Relies on the `files.owner_id → users.id ON DELETE CASCADE` and
 *   `srp_sessions.user_id → users.id ON DELETE CASCADE` FKs added in the
 *   Phase 8 follow-up migration. Older deployments missing those cascades
 *   will hit an FK violation here.
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

    // Collect (shard, storageKey) pairs to delete after the DB cascade.
    // Legacy `files.storage_key` branch is gone; all content lives on
    // file_chunks.
    const { data: files } = await supabase
      .from("files")
      .select("id")
      .eq("owner_id", targetId);
    const fileIds = (files || []).map((f) => f.id);

    let orphanedChunks: { shard: number; storageKey: string }[] = [];
    if (fileIds.length > 0) {
      const { data: chunks } = await supabase
        .from("file_chunks")
        .select("storage_key, shard")
        .in("file_id", fileIds);
      orphanedChunks = (chunks || [])
        .filter((c) => !!c.storage_key)
        .map((c) => ({
          storageKey: c.storage_key as string,
          shard: (c.shard as number | null) ?? 0,
        }));
    }

    // Delete DB row first (cascades). R2 cleanup is best-effort afterwards.
    const { error: delErr } = await supabase.from("users").delete().eq("id", targetId);
    if (delErr) throw delErr;

    // Log BEFORE R2 cleanup in case the blob deletes take a while.
    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "user.delete",
      targetUserId: targetId,
      detail: `email=${target.email} blobs=${orphanedChunks.length} reason=${parsed.data.reason ?? ""}`,
    });

    // R2 cleanup — best-effort. If a shard's delete fails, nightly
    // cleanup sweeps orphans (their DB rows are already gone).
    try {
      await deleteBlobs(orphanedChunks);
    } catch (err) {
      logError("admin.users.delete.r2", err);
    }

    return NextResponse.json({ success: true, blobsDeleted: orphanedChunks.length });
  } catch (err) {
    logError("admin.users.delete", err);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
