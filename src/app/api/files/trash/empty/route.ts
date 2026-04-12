import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { deleteBlob } from "@/lib/db/r2";
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

    // Collect storage keys for every trashed owned file + their chunks.
    const { data: trashedFiles, error: loadErr } = await supabase
      .from("files")
      .select("id, storage_key")
      .eq("owner_id", session.userId)
      .not("deleted_at", "is", null);
    if (loadErr) throw new Error(`Trash lookup failed: ${loadErr.message}`);
    const trashedIds = (trashedFiles || []).map((r) => r.id);
    if (trashedIds.length === 0) {
      return NextResponse.json({ success: true, purged: 0 });
    }

    const { data: chunks, error: chunkErr } = await supabase
      .from("file_chunks")
      .select("storage_key")
      .in("file_id", trashedIds);
    if (chunkErr) throw new Error(`Chunk lookup failed: ${chunkErr.message}`);

    const storageKeys: string[] = [
      ...(trashedFiles || [])
        .map((r) => r.storage_key as string | null)
        .filter((k): k is string => !!k),
      ...((chunks || []).map((r) => r.storage_key as string)),
    ];

    // R2 cleanup — best-effort. A leaked blob is cheap; blocking
    // the DB delete on R2 availability is not.
    await Promise.all(
      storageKeys.map(async (key) => {
        try {
          await deleteBlob(key);
        } catch (err) {
          logError("files.trash.empty.r2", err);
        }
      })
    );

    const { error: delErr } = await supabase
      .from("files")
      .delete()
      .eq("owner_id", session.userId)
      .not("deleted_at", "is", null);
    if (delErr) throw new Error(`Delete failed: ${delErr.message}`);

    auditEvent({
      event: "files.purge",
      actorUserId: session.userId,
      detail: `empty trash: ${trashedIds.length} rows, ${storageKeys.length} blobs`,
    });

    return NextResponse.json({ success: true, purged: trashedIds.length });
  } catch (err) {
    logError("files.trash.empty", err);
    return NextResponse.json({ error: "Empty trash failed" }, { status: 500 });
  }
}
