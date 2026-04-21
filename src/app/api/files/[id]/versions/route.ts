import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getEffectivePermission, listFileVersions } from "@/lib/db/files";
import { logError } from "@/lib/log";

/**
 * GET /api/files/[id]/versions — list every version of a file in
 * newest-first order. Owner + editors only: viewers can't see edit
 * history because a file shared with them at vN may have carried
 * sensitive content in vN-1 that the owner redacted.
 *
 * Crypto v2 Phase 4: each version now has its own session-key wrap
 * (fresh key per new-version upload). The response ships each
 * version's `encryptedSessionKeyByFile` + `sessionKeyNonce` so the
 * client can unwrap per-version and decrypt that version's
 * `encryptedMetadata`. Historical versions' wraps are cryptographically
 * reachable from the file's hier private key (which the caller has
 * via their `file_keys` row); forward secrecy applies to revoked
 * users, not current collaborators browsing history.
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

    // Access gate: owner or editor only. Viewers lose access (404 to
    // avoid leaking version-history existence to a user who can read
    // the current file but nothing behind it).
    const perm = await getEffectivePermission(parsed.data.id, session.userId);
    if (!perm || perm === "viewer") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const versions = await listFileVersions(parsed.data.id);

    return NextResponse.json({
      versions: versions.map((v) => ({
        id: v.id,
        versionNumber: v.version_number,
        encryptedMetadata: v.encrypted_metadata,
        encryptedSessionKeyByFile: v.encrypted_session_key_by_file,
        sessionKeyNonce: v.session_key_nonce ?? "",
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
