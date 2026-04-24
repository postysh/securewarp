import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import {
  getOwnedFile,
  moveFile,
  isDescendantOf,
  getEffectivePermission,
} from "@/lib/db/files";
import { recordFileAccess } from "@/lib/db/file-access";
import { supabase } from "@/lib/db/supabase";
import { auditEvent } from "@/lib/audit";
import { broadcastFileMutation } from "@/lib/realtime/broadcast";
import { logError } from "@/lib/log";

// Owner-only move. The caller re-wraps `parent_keys_claim` on the
// client (under the new parent's public hier key) and ships the
// ciphertext here — the server never sees the plaintext session
// key or private hier key.
//
// Validation the server owns:
//   1. Caller owns the file being moved.
//   2. If newParentId is non-null, caller owns it AND it's a folder.
//   3. The move doesn't introduce a cycle (can't move a folder into
//      itself or any of its descendants).
//   4. When moving to root (newParentId null), both claim fields
//      MUST also be null — there's no parent key to wrap under.
//      When moving under a folder, both MUST be present.

const MoveSchema = z.object({
  newParentId: z.string().uuid().nullable(),
  parentKeysClaim: z.string().nullable(),
  parentKeysClaimWrappedBy: z.string().nullable(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: fileId } = await params;
    const body = await request.json();
    const parsed = MoveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }
    const { newParentId, parentKeysClaim, parentKeysClaimWrappedBy } = parsed.data;

    // Enforce the claim-null coupling before hitting the DB.
    if (newParentId === null) {
      if (parentKeysClaim !== null || parentKeysClaimWrappedBy !== null) {
        return NextResponse.json(
          { error: "parent_keys_claim must be null when moving to root" },
          { status: 400 }
        );
      }
    } else {
      if (!parentKeysClaim || !parentKeysClaimWrappedBy) {
        return NextResponse.json(
          { error: "parent_keys_claim required when moving under a folder" },
          { status: 400 }
        );
      }
    }

    // 1. Caller must have editor+ access to the file being moved.
    //    Try ownership first, fall back to inherited workspace permission.
    let file: {
      id: string;
      owner_id: string;
      parent_id: string | null;
      is_folder: boolean;
      deleted_at: string | null;
      workspace_id: string | null;
    } | null = null;
    {
      const { data } = await supabase
        .from("files")
        .select("id, owner_id, parent_id, is_folder, deleted_at, workspace_id")
        .eq("id", fileId)
        .single();
      if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
      file = data;
    }
    const isOwner = file.owner_id === session.userId;
    if (!isOwner) {
      const perm = await getEffectivePermission(fileId, session.userId);
      if (!perm || perm === "viewer") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }
    if (file.deleted_at) {
      return NextResponse.json({ error: "File is in trash" }, { status: 400 });
    }

    // No-op move (same parent).
    if (file.parent_id === newParentId) {
      return NextResponse.json({ success: true });
    }

    // 2. Destination must be a folder the caller can write to (or null for root).
    let destWorkspaceId: string | null = null;
    if (newParentId !== null) {
      let dest: { id: string; is_folder: boolean; deleted_at: string | null; workspace_id: string | null } | null = await (async () => {
        const owned = await getOwnedFile(newParentId, session.userId);
        if (!owned) return null;
        const { data } = await supabase
          .from("files")
          .select("id, is_folder, deleted_at, workspace_id")
          .eq("id", newParentId)
          .single();
        return data;
      })();
      if (!dest) {
        const destPerm = await getEffectivePermission(newParentId, session.userId);
        if (!destPerm || destPerm === "viewer") {
          return NextResponse.json({ error: "Destination not found" }, { status: 404 });
        }
        const { data } = await supabase
          .from("files")
          .select("id, is_folder, deleted_at, workspace_id")
          .eq("id", newParentId)
          .single();
        if (!data) return NextResponse.json({ error: "Destination not found" }, { status: 404 });
        dest = data;
      }
      if (!dest) return NextResponse.json({ error: "Destination not found" }, { status: 404 });
      if (!dest.is_folder) {
        return NextResponse.json({ error: "Destination is not a folder" }, { status: 400 });
      }
      if (dest.deleted_at) {
        return NextResponse.json({ error: "Destination is in trash" }, { status: 400 });
      }
      destWorkspaceId = (dest.workspace_id as string | null) ?? null;

      // 3. Cycle check — can't move a folder into itself or any descendant.
      if (file.is_folder) {
        const wouldCycle = await isDescendantOf(fileId, newParentId);
        if (wouldCycle) {
          return NextResponse.json(
            { error: "Cannot move a folder into itself or one of its children" },
            { status: 400 }
          );
        }
      }
    }

    // 4. Workspace-boundary guard. Only the owner may move a file
    //    across workspace_id. A non-owner editor yanking a workspace
    //    file into their personal drive (destWorkspaceId=null) would
    //    orphan it from every other collaborator's view — no workspace
    //    listing would surface it and the file's new parent is in a
    //    folder only the mover can navigate to. Covers all three
    //    cross-boundary shapes: workspace→personal, personal→workspace,
    //    and workspace→different-workspace.
    if (!isOwner && file.workspace_id !== destWorkspaceId) {
      return NextResponse.json(
        { error: "Only the file owner can move this file out of its workspace" },
        { status: 403 }
      );
    }

    await moveFile(
      fileId,
      newParentId,
      parentKeysClaim,
      parentKeysClaimWrappedBy,
      destWorkspaceId
    );

    // Moving is an interaction — bump Recent for the actor.
    await recordFileAccess(session.userId, fileId);

    auditEvent({
      event: "files.move",
      actorUserId: session.userId,
      targetFileId: fileId,
      detail: newParentId ?? "root",
    });

    await broadcastFileMutation(fileId, "file.moved", {
      newParentId: newParentId ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.move", err);
    return NextResponse.json({ error: "Move failed" }, { status: 500 });
  }
}
