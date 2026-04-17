import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getEffectivePermission, listFileVersions } from "@/lib/db/files";
import { logError } from "@/lib/log";

/**
 * GET /api/files/[id]/versions — list every version of a file in
 * newest-first order. Gated by the caller's effective permission on
 * the file (owner, editor, viewer — anyone with access can browse
 * versions they could read when each version existed).
 *
 * The response ships encrypted_metadata as-is: the client decrypts
 * locally with the shared session key (same key across all versions),
 * so the server never learns old filenames.
 */

const PARAMS = z.object({ id: z.string().uuid() });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolved = await params;
    const parsed = PARAMS.safeParse(resolved);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    // Access check: any permission level can read versions. If the
    // user has no row on this file at all, return 404 so we don't
    // leak existence.
    const perm = await getEffectivePermission(parsed.data.id, session.userId);
    if (!perm) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const versions = await listFileVersions(parsed.data.id);

    return NextResponse.json({
      versions: versions.map((v) => ({
        id: v.id,
        versionNumber: v.version_number,
        encryptedMetadata: v.encrypted_metadata,
        sizeBytes: v.size_bytes,
        chunkCount: v.chunk_count,
        createdAt: v.created_at,
        // createdByUserId intentionally dropped from the wire — we
        // don't want the client-side UI to render a user-id string
        // a future refactor could accidentally expose. If we later
        // want to show "created by Alice", add a server-side join
        // and return display_name only.
      })),
    });
  } catch (err) {
    logError("files.versions.list", err);
    return NextResponse.json({ error: "Failed to load versions" }, { status: 500 });
  }
}
