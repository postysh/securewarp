import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import {
  trashSubtree,
  trashSubtreeUnscoped,
  getOwnedFile,
  getEffectivePermission,
} from "@/lib/db/files";
import { supabase } from "@/lib/db/supabase";
import { auditEvent } from "@/lib/audit";
import { broadcastFileMutation } from "@/lib/realtime/broadcast";
import { logError } from "@/lib/log";

// Owner-only soft delete. Recursively marks the file (or every
// descendant of a folder) with `deleted_at = now()`. Rows stay in
// the DB and blobs stay in R2 so a user can restore them from the
// Trash view. A separate /purge path permanently removes a single
// trashed item, and /trash/empty hard-deletes everything currently
// in trash — the only place R2 cleanup actually runs.
//
// Shared collaborators: not affected. Their `file_keys` rows are
// intact; they just won't see the file in their "Shared with me"
// view because `getSharedWithUser` now filters `deleted_at IS NULL`.
// If the owner later restores the file the grants light back up.

const DeleteSchema = z.object({
  fileId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = DeleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const fileId = parsed.data.fileId;

    // Access gate: owner can trash directly. In workspaces, editors+
    // can also trash files they don't own — we use an unscoped RPC
    // so mixed-owner subtrees get trashed atomically instead of
    // partial-trashing only the named owner's rows.
    const owned = await getOwnedFile(fileId, session.userId);
    if (!owned) {
      const perm = await getEffectivePermission(fileId, session.userId);
      if (!perm || perm === "viewer") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const { data: fileRow } = await supabase
        .from("files")
        .select("id, is_workspace_root, workspace_id")
        .eq("id", fileId)
        .single();
      if (!fileRow) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (fileRow.is_workspace_root) {
        return NextResponse.json({ error: "Cannot delete a workspace folder. Delete the workspace instead." }, { status: 400 });
      }
      // Workspace subtree trash: permission was validated above; the
      // RPC flips every descendant regardless of per-row owner.
      await trashSubtreeUnscoped(fileId);
    } else {
      if (owned.is_workspace_root) {
        return NextResponse.json({ error: "Cannot delete a workspace folder. Delete the workspace instead." }, { status: 400 });
      }
      // Personal-drive subtree: scoped to caller's owned rows. Since
      // the caller owns the root and personal-drive descendants are
      // always caller-owned, scoped is sufficient and tighter.
      await trashSubtree(fileId, session.userId);
    }

    auditEvent({
      event: "files.delete",
      actorUserId: session.userId,
      targetFileId: fileId,
      detail: "trashed",
    });

    // Broadcast AFTER the soft-delete. The row still has its
    // workspace_id set (soft delete doesn't nullify it) so the
    // helper can find the channel. Members re-fetch their current
    // view and the trashed row drops out of the listing.
    await broadcastFileMutation(fileId, "file.trashed");

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.delete", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
