import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { revokeFileAccess, getOwnedFile } from "@/lib/db/files";
import { logError } from "@/lib/log";

const LeaveSchema = z.object({ fileId: z.string().uuid() });

/**
 * "Remove from shared with me" — a collaborator deletes their own
 * file_keys row for a file they don't own. Different from /unshare in
 * intent (self-only, no target user) and different from /delete (which is
 * owner-only and removes the blob + all keys).
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = LeaveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    // Owners must use /api/files/delete instead — leaving your own file
    // would orphan the blob and confuse the "shared with me" invariant
    // (files returned by getSharedWithUser excludes owned files).
    const owned = await getOwnedFile(parsed.data.fileId, session.userId);
    if (owned) {
      return NextResponse.json(
        { error: "You own this file — use delete instead" },
        { status: 400 }
      );
    }

    await revokeFileAccess(parsed.data.fileId, session.userId);
    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.leave", err);
    return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
  }
}
