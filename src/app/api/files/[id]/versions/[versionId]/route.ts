import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import {
  deleteFileVersion,
  getFileById,
  getFileVersion,
} from "@/lib/db/files";
import { deleteBlob } from "@/lib/db/r2";
import { supabase } from "@/lib/db/supabase";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

/**
 * DELETE /api/files/[id]/versions/[versionId]
 *
 * Owner-only. Removes a past version and purges R2 blobs that became
 * orphaned (i.e. no other version references them). The CURRENT
 * version cannot be deleted — reject with 400 — because there'd be
 * no content left to list. To "remove all versions", delete the
 * whole file instead.
 */

const PARAMS = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
});

export async function DELETE(
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

    const file = await getFileById(parsed.data.id, session.userId);
    if (!file || file.owner_id !== session.userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const version = await getFileVersion(parsed.data.versionId);
    if (!version || version.file_id !== parsed.data.id) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    // Fetch current_version_number explicitly so the FileRow ORM
    // typing doesn't gate on a field getFileById may not project.
    const { data: freshFile } = await supabase
      .from("files")
      .select("current_version_number")
      .eq("id", parsed.data.id)
      .single();
    if (
      freshFile &&
      (freshFile.current_version_number as number) === version.version_number
    ) {
      return NextResponse.json(
        { error: "Cannot delete the current version" },
        { status: 400 },
      );
    }

    const orphanedStorageKeys = await deleteFileVersion(parsed.data.versionId);

    // Recount remaining versions so the denormalized version_count
    // stays honest. Deletes are rare enough that a single COUNT is
    // fine vs chasing a decrement across retries.
    const { count: remaining } = await supabase
      .from("file_versions")
      .select("id", { count: "exact", head: true })
      .eq("file_id", parsed.data.id);
    const { error: decErr } = await supabase
      .from("files")
      .update({
        version_count: Math.max(1, remaining ?? 1),
        updated_at: new Date().toISOString(),
      })
      .eq("id", parsed.data.id);
    if (decErr) logError("files.version.delete.count", decErr);

    // Best-effort R2 cleanup. A failed delete just leaves an orphan
    // blob — cheap to tolerate and easy to sweep with a retention
    // job later. Don't throw on R2 errors.
    for (const key of orphanedStorageKeys) {
      try {
        await deleteBlob(key);
      } catch (err) {
        logError("files.version.delete.r2", { key, err });
      }
    }

    auditEvent({
      event: "files.version_delete",
      actorUserId: session.userId,
      targetFileId: parsed.data.id,
      detail: `v${version.version_number} (${orphanedStorageKeys.length} blobs purged)`,
    });

    return NextResponse.json({
      ok: true,
      orphanedStorageKeys: orphanedStorageKeys.length,
    });
  } catch (err) {
    logError("files.version.delete", err);
    return NextResponse.json(
      { error: "Failed to delete version" },
      { status: 500 },
    );
  }
}
