import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getFileById, restoreFileVersion } from "@/lib/db/files";
import { supabase } from "@/lib/db/supabase";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

/**
 * POST /api/files/[id]/versions/[versionId]/restore
 *
 * Restores a file to the content of an older version by creating a
 * brand-new version whose chunks reference the same R2 blobs as the
 * source version. Metadata (filename, size) is copied verbatim —
 * client still decrypts using the shared session key.
 *
 * Owner-only. Restoring doesn't delete history; the old current
 * version becomes "just another past version" in the list.
 */

const PARAMS = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
});

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolved = await params;
    const parsed = PARAMS.safeParse(resolved);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
    }

    // Owner-only gate. Collaborators see history (via the list
    // endpoint) but can't mutate it for now; later we can let
    // editors restore too.
    const file = await getFileById(parsed.data.id, session.userId);
    if (!file || file.owner_id !== session.userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const newVersion = await restoreFileVersion({
      fileId: parsed.data.id,
      sourceVersionId: parsed.data.versionId,
      actorUserId: session.userId,
    });

    // Point `files` at the new version so lists render the restored
    // metadata immediately.
    const filesUpdate: Record<string, unknown> = {
      current_version_number: newVersion.version_number,
      version_count: newVersion.version_number,
      encrypted_metadata: newVersion.encrypted_metadata,
      size_bytes: newVersion.size_bytes,
      chunk_count: newVersion.chunk_count,
      // Phase 4: mirror the restored version's session-key wrap up
      // to the files row so list + download flows resolve without
      // an extra query.
      encrypted_session_key_by_file: newVersion.encrypted_session_key_by_file,
      session_key_nonce: newVersion.session_key_nonce,
      updated_at: new Date().toISOString(),
    };
    // parent_keys_claim ALSO has to come along when the source
    // version has one — inherited-access readers pull the session
    // key out of the claim, so leaving the pre-restore claim in
    // place would have workspace members decrypt with the wrong key.
    // Only overwrite when the source had a claim: restoring a pre-
    // PKC-tracking version shouldn't blank a non-null files PKC.
    if (newVersion.parent_keys_claim && newVersion.parent_keys_claim_wrapped_by) {
      filesUpdate.parent_keys_claim = newVersion.parent_keys_claim;
      filesUpdate.parent_keys_claim_wrapped_by = newVersion.parent_keys_claim_wrapped_by;
    }
    const { error: updateErr } = await supabase
      .from("files")
      .update(filesUpdate)
      .eq("id", parsed.data.id)
      .eq("owner_id", session.userId);
    if (updateErr) throw updateErr;

    auditEvent({
      event: "files.version_restore",
      actorUserId: session.userId,
      targetFileId: parsed.data.id,
      detail: `v${newVersion.version_number}`,
    });

    return NextResponse.json({
      versionId: newVersion.id,
      versionNumber: newVersion.version_number,
    });
  } catch (err) {
    logError("files.version.restore", err);
    return NextResponse.json(
      { error: "Failed to restore version" },
      { status: 500 },
    );
  }
}
