import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { revokeLink } from "@/lib/db/files";
import { logError } from "@/lib/log";

const ParamSchema = z.object({ id: z.string().uuid() });

/**
 * Revoke a link. Either the link creator or the file owner may call.
 * Sets `revoked_at = now()` (soft delete) so the row remains for audit;
 * anonymous lookups treat revoked links as 404.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const parsed = ParamSchema.safeParse({ id });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid link id" }, { status: 400 });
    }

    const ok = await revokeLink(parsed.data.id, session.userId);
    if (!ok) {
      return NextResponse.json({ error: "Link not found or not yours to revoke" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.link.revoke", err);
    return NextResponse.json({ error: "Failed to revoke link" }, { status: 500 });
  }
}
