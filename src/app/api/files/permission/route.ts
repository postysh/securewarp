import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getOwnedFile, setCollaboratorPermission } from "@/lib/db/files";
import { createNotification } from "@/lib/db/notifications";
import { logError } from "@/lib/log";

const Schema = z.object({
  fileId: z.string().uuid(),
  userId: z.string().uuid(),
  level: z.enum(["editor", "viewer"]),
});

/**
 * Owner-only permission change. Does not alter the wrapped session key —
 * Phase 1 Viewer/Editor is enforced by the server refusing write endpoints
 * for viewers, not by withholding key material. See AGENTS.md §Sharing.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const file = await getOwnedFile(parsed.data.fileId, session.userId);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (parsed.data.userId === session.userId) {
      return NextResponse.json(
        { error: "Cannot change your own permission as the owner" },
        { status: 400 }
      );
    }

    await setCollaboratorPermission(parsed.data.fileId, parsed.data.userId, parsed.data.level);

    createNotification({
      userId: parsed.data.userId,
      type: "permission_changed",
      title: "Permission updated",
      description: `${session.email} changed your access to ${parsed.data.level}`,
      fileId: parsed.data.fileId,
      actorUserId: session.userId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.permission", err);
    return NextResponse.json({ error: "Failed to update permission" }, { status: 500 });
  }
}
