import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { restoreSubtree } from "@/lib/db/files";
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

    // Owner check AND trashed-state check. `getOwnedFile` wouldn't
    // tell us whether the row is trashed, and we want to reject
    // restore-of-live-file so the client can't rely on the endpoint
    // being a no-op.
    const { data: row, error: loadErr } = await supabase
      .from("files")
      .select("id, deleted_at")
      .eq("id", fileId)
      .eq("owner_id", session.userId)
      .single();
    if (loadErr || !row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!row.deleted_at) {
      return NextResponse.json({ error: "Not in trash" }, { status: 400 });
    }

    await restoreSubtree(fileId, session.userId);

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
