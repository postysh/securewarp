import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getFileById, getCollaborators } from "@/lib/db/files";
import { logError } from "@/lib/log";

const QuerySchema = z.object({ fileId: z.string().uuid() });

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({ fileId: searchParams.get("fileId") });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid fileId" }, { status: 400 });
    }

    // Anyone with access to the file may list its collaborators — reuses the
    // existing file_keys join in getFileById to enforce that.
    const file = await getFileById(parsed.data.fileId, session.userId);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const collaborators = await getCollaborators(parsed.data.fileId);
    return NextResponse.json({
      ownerId: file.owner_id,
      collaborators: collaborators.map((c) => ({
        userId: c.user_id,
        email: c.email,
        publicEncryptionKey: c.public_encryption_key,
        isOwner: c.is_owner,
        permissionLevel: c.permission_level,
      })),
    });
  } catch (err) {
    logError("files.collaborators", err);
    return NextResponse.json({ error: "Failed to load collaborators" }, { status: 500 });
  }
}
