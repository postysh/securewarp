import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getFileById, getLinksForFile } from "@/lib/db/files";
import { logError } from "@/lib/log";

const QuerySchema = z.object({ fileId: z.string().uuid() });

/**
 * Authenticated list of active (non-revoked, non-expired) links for a
 * file. Used by the share modal's "Link access" section. Does not
 * include the linkKey or any ciphertext the visitor would need — the
 * URL is unrecoverable after creation, so after a link is minted it
 * only exists inside whoever copied it.
 */
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

    const file = await getFileById(parsed.data.fileId, session.userId);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const rows = await getLinksForFile(parsed.data.fileId);
    return NextResponse.json({
      links: rows.map((r) => ({
        id: r.id,
        createdBy: r.created_by,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        permissionLevel: r.permission_level,
      })),
    });
  } catch (err) {
    logError("files.link.list", err);
    return NextResponse.json({ error: "Failed to list links" }, { status: 500 });
  }
}
