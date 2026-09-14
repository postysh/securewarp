import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getFileWithEffectivePermission, updateFileMetadata } from "@/lib/db/files";
import { recordFileAccess } from "@/lib/db/file-access";
import { auditEvent } from "@/lib/audit";
import { broadcastFileMutation } from "@/lib/realtime/broadcast";
import { logError } from "@/lib/log";

// Any owner or editor (direct `file_keys` row or inherited via a
// parent folder) may rename. Viewers may not — a viewer holds the
// private hierarchical key for decrypt, but rename overwrites
// `encrypted_metadata`, which the server can't validate; a read-only
// grant must not include the ability to clobber the name for everyone.
// This matches Skiff/Proton where shared-folder editors can organize
// the contents they've been given access to.
//
// The server does not validate the new name — it can't, the value is
// an opaque ciphertext under the file's session key. The only thing
// that can prevent tampering is the session key itself, which the
// caller must hold to have produced a valid blob.

const RenameSchema = z.object({
  encryptedMetadata: z.string().min(1).max(8192),
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

    // Access gate: live file + effective permission, computed
    // unconditionally so a direct-row viewer can't skip the check.
    const access = await getFileWithEffectivePermission(fileId, session.userId);
    if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (access.permission === "viewer") {
      return NextResponse.json({ error: "Viewers cannot rename" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = RenameSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    await updateFileMetadata(fileId, parsed.data.encryptedMetadata);

    // Renaming is an interaction — bump Recent for the actor so the
    // file they just touched moves to the top of their list. Awaited
    // because CF Workers can terminate the worker as soon as the HTTP
    // response is sent, which would kill an un-awaited DB write.
    await recordFileAccess(session.userId, fileId);

    auditEvent({
      event: "files.rename",
      actorUserId: session.userId,
      detail: fileId,
    });

    await broadcastFileMutation(fileId, "file.renamed");

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.rename", err);
    return NextResponse.json({ error: "Rename failed" }, { status: 500 });
  }
}
