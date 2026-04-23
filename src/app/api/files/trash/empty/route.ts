import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { deleteBlobs } from "@/lib/db/r2";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

// Hard-delete everything currently in the caller's trash. Same
// shape as /purge but scoped to "every owned row where
// deleted_at IS NOT NULL" rather than a single root.

export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Collect (shard, storage_key) for every chunk in trashed files.
    // Legacy files.storage_key branch is gone.
    const { data: trashedFiles, error: loadErr } = await supabase
      .from("files")
      .select("id")
      .eq("owner_id", session.userId)
      .not("deleted_at", "is", null);
    if (loadErr) throw new Error(`Trash lookup failed: ${loadErr.message}`);
    const trashedIds = (trashedFiles || []).map((r) => r.id);
    if (trashedIds.length === 0) {
      return NextResponse.json({ success: true, purged: 0 });
    }

    const { data: chunks, error: chunkErr } = await supabase
      .from("file_chunks")
      .select("storage_key, shard")
      .in("file_id", trashedIds);
    if (chunkErr) throw new Error(`Chunk lookup failed: ${chunkErr.message}`);

    const orphanedChunks = (chunks || [])
      .filter((c) => !!c.storage_key)
      .map((c) => ({
        storageKey: c.storage_key as string,
        shard: (c.shard as number | null) ?? 0,
      }));

    // R2 cleanup — best-effort. A leaked blob is cheap; blocking
    // the DB delete on R2 availability is not.
    try {
      await deleteBlobs(orphanedChunks);
    } catch (err) {
      logError("files.trash.empty.r2", err);
    }

    const { error: delErr } = await supabase
      .from("files")
      .delete()
      .eq("owner_id", session.userId)
      .not("deleted_at", "is", null);
    if (delErr) throw new Error(`Delete failed: ${delErr.message}`);

    auditEvent({
      event: "files.purge",
      actorUserId: session.userId,
      detail: `empty trash: ${trashedIds.length} rows, ${orphanedChunks.length} blobs`,
    });

    return NextResponse.json({ success: true, purged: trashedIds.length });
  } catch (err) {
    logError("files.trash.empty", err);
    return NextResponse.json({ error: "Empty trash failed" }, { status: 500 });
  }
}
