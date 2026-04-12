import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getFileById, updateFileMetadata, getEffectivePermission } from "@/lib/db/files";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

// Any collaborator (anyone with a `file_keys` row on this file) may
// rename. This matches the Phase 2/3 sharing model where the private
// hierarchical key grants full decrypt + re-encrypt capability, and
// matches Skiff/Proton where shared-folder members can organize the
// contents they've been given access to.
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

    // Access gate: the caller must have a `file_keys` row on this
    // file. `getFileById` joins on user_id + upload_complete so a
    // revoked or in-flight file won't match.
    const file = await getFileById(fileId, session.userId);
    if (!file) {
      // Check inherited access
      const perm = await getEffectivePermission(fileId, session.userId);
      if (!perm) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (perm === "viewer") return NextResponse.json({ error: "Viewers cannot rename" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = RenameSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    await updateFileMetadata(fileId, parsed.data.encryptedMetadata);

    auditEvent({
      event: "files.rename",
      actorUserId: session.userId,
      detail: fileId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.rename", err);
    return NextResponse.json({ error: "Rename failed" }, { status: 500 });
  }
}
