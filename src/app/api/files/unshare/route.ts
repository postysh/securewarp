import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getOwnedFile, revokeFileAccess } from "@/lib/db/files";
import { logError } from "@/lib/log";

const UnshareSchema = z.object({
  fileId: z.string().uuid(),
  userId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = UnshareSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid unshare data" }, { status: 400 });
    }
    const { fileId, userId: targetUserId } = parsed.data;

    // Two allowed flows:
    //   1. Owner removes a collaborator.
    //   2. Collaborator removes themselves ("leave share").
    // Anyone else is rejected.
    const file = await getOwnedFile(fileId, session.userId);
    const isOwner = file !== null;
    const isSelfRemoval = targetUserId === session.userId;

    if (!isOwner && !isSelfRemoval) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // The owner's own key row must not be deleted — removing it would hide
    // the file from the owner and leave an undeletable orphan.
    if (isOwner && targetUserId === session.userId) {
      return NextResponse.json(
        { error: "Cannot remove yourself as the owner" },
        { status: 400 }
      );
    }

    await revokeFileAccess(fileId, targetUserId);
    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.unshare", err);
    return NextResponse.json({ error: "Unshare failed" }, { status: 500 });
  }
}
