import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import {
  restoreSubtree,
  restoreSubtreeUnscoped,
  getEffectivePermission,
} from "@/lib/db/files";
import { supabase } from "@/lib/db/supabase";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

// Owner-only restore from trash. Reverses the recursive soft delete
// for rows whose `deleted_at` matches the root's — so a file the
// user individually trashed earlier stays trashed when the parent
// folder gets restored later.

const RestoreSchema = z.object({
  fileId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = RestoreSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const fileId = parsed.data.fileId;

    // Check ownership first, fall back to workspace permission
    const { data: row, error: loadErr } = await supabase
      .from("files")
      .select("id, deleted_at, owner_id, workspace_id")
      .eq("id", fileId)
      .single();
    if (loadErr || !row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!row.deleted_at) {
      return NextResponse.json({ error: "Not in trash" }, { status: 400 });
    }

    const isOwner = row.owner_id === session.userId;
    if (!isOwner) {
      // In workspace context, editors+ can restore
      if (!row.workspace_id) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const perm = await getEffectivePermission(fileId, session.userId);
      if (!perm || perm === "viewer") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      // Workspace restore: unscoped so mixed-owner subtrees are
      // reversed as a unit.
      await restoreSubtreeUnscoped(fileId);
    } else {
      await restoreSubtree(fileId, row.owner_id as string);
    }

    auditEvent({
      event: "files.restore",
      actorUserId: session.userId,
      targetFileId: fileId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.restore", err);
    return NextResponse.json({ error: "Restore failed" }, { status: 500 });
  }
}
