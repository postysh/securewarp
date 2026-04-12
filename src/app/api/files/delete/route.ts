import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { trashSubtree, getOwnedFile } from "@/lib/db/files";
import { auditEvent } from "@/lib/audit";
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

    // Access gate: only the owner can trash. Non-owners use /leave
    // to remove themselves from a shared file.
    const owned = await getOwnedFile(fileId, session.userId);
    if (!owned) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await trashSubtree(fileId, session.userId);

    auditEvent({
      event: "files.delete",
      actorUserId: session.userId,
      targetFileId: fileId,
      detail: "trashed",
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.delete", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
