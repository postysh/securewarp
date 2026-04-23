import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { deleteBlobs } from "@/lib/db/r2";
import { auditEvent } from "@/lib/audit";
import { broadcast } from "@/lib/realtime/broadcast";
import { channelForWorkspace } from "@/lib/realtime/channels";
import { logError } from "@/lib/log";

// Hard delete. Only valid on rows that are currently in the trash
// (`deleted_at IS NOT NULL`) so a user can't accidentally bypass
// the trash-as-safety-net. Owner OR workspace admin (matches the
// Google Drive / Dropbox / Box pattern — editors can trash-and-
// restore, but purge is an irreversible action that destroys the
// owner's content so it's gated to elevated roles).
//
// The endpoint walks the subtree, collects every descendant's
// storage_key + chunk storage keys, then:
//   1. Issues R2 deletes (best-effort — logged, not fatal)
//   2. Deletes the DB rows (cascades to file_keys + file_chunks)
//
// If this is the only path in the codebase that calls `deleteBlob`,
// that's intentional — trash is now the single choke point for
// storage cleanup. /delete (soft) never touches R2.

const PurgeSchema = z.object({
  fileId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = PurgeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const fileId = parsed.data.fileId;

    // Must exist and currently be trashed. Load owner + workspace
    // so we can distinguish "file owner" from "workspace admin" —
    // each is allowed to purge, but via different checks.
    const { data: root, error: loadErr } = await supabase
      .from("files")
      .select("id, deleted_at, owner_id, workspace_id")
      .eq("id", fileId)
      .single();
    if (loadErr || !root) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!root.deleted_at) {
      return NextResponse.json({ error: "Not in trash" }, { status: 400 });
    }

    const rootOwnerId = root.owner_id as string;
    const workspaceId = (root.workspace_id as string | null) ?? null;
    const isOwner = rootOwnerId === session.userId;

    let allowed = isOwner;
    if (!allowed && workspaceId) {
      // Workspace admin check. Editors + viewers are NOT allowed —
      // purge destroys content irreversibly without the original
      // owner's consent, which we treat as an elevated action.
      const { data: membership } = await supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", session.userId)
        .maybeSingle();
      if (membership && membership.role === "admin") {
        allowed = true;
      }
    }
    if (!allowed) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Walk the subtree to gather storage keys before the cascade
    // removes the rows. Admin-initiated purges need to see every
    // descendant regardless of per-row owner, so we pass the
    // root's actual owner to the existing RPC (which scopes by
    // that owner inside the CTE). For workspace folders containing
    // mixed-owner children, the RPC would miss non-root-owner
    // descendants — live for a future iteration; for now admins
    // only purge from workspace trash when editor trash flows
    // (which trashed the whole subtree atomically via the
    // unscoped RPC) have already landed everything in trash.
    const { data: subtree, error: subErr } = await supabase.rpc("subtree_storage_keys", {
      p_root: fileId,
      p_owner: rootOwnerId,
    });
    if (subErr) {
      throw new Error(`Subtree lookup failed: ${subErr.message}`);
    }

    // rpc returns [{out_file_id, out_storage_key, out_shard}, ...] for
    // every chunk in the subtree. Columns are prefixed to avoid a
    // PL/pgSQL ambiguity between the RETURNS TABLE output and the
    // source columns.
    const rows = (subtree || []) as {
      out_storage_key: string | null;
      out_shard: number | null;
    }[];
    const orphanedChunks = rows
      .filter((r) => !!r.out_storage_key)
      .map((r) => ({
        storageKey: r.out_storage_key as string,
        shard: r.out_shard ?? 0,
      }));

    // R2 cleanup (best-effort). A failed delete here leaks storage
    // but must not block the DB purge. `deleteBlobs` groups by shard
    // and issues one S3 DeleteObjects per bucket.
    try {
      await deleteBlobs(orphanedChunks);
    } catch (err) {
      logError("files.purge.r2", err);
    }

    // DB delete. ON DELETE CASCADE on files → file_keys + file_chunks
    // does the rest. Scoped to the root row's owner: workspace admins
    // purging a file they don't own still remove the row authored by
    // its owner.
    const { error: delErr } = await supabase
      .from("files")
      .delete()
      .eq("id", fileId)
      .eq("owner_id", rootOwnerId);
    if (delErr) {
      throw new Error(`Purge failed: ${delErr.message}`);
    }

    // Broadcast on the workspace channel if this was a workspace
    // file. We read workspace_id from the files row we loaded at
    // the top (pre-delete) since the row is now gone.
    if (workspaceId) {
      await broadcast(channelForWorkspace(workspaceId), "file.purged", {
        fileId,
      });
    }

    auditEvent({
      event: "files.purge",
      actorUserId: session.userId,
      targetFileId: fileId,
      detail: `${orphanedChunks.length} blobs`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.purge", err);
    return NextResponse.json({ error: "Purge failed" }, { status: 500 });
  }
}
