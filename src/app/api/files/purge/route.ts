import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { deleteBlob } from "@/lib/db/r2";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

// Hard delete. Only valid on rows that are currently in the trash
// (`deleted_at IS NOT NULL`) so a user can't accidentally bypass
// the trash-as-safety-net. Owner-only.
//
// The endpoint walks the subtree, collects every descendant's
// storage_key + chunk storage keys, then:
//   1. Issues R2 deletes (best-effort — logged, not fatal)
//   2. Deletes the DB rows (cascades to file_keys + file_chunks)
//
// If this is the only path in the codebase that calls `deleteBlob`,
// that's intentional — trash is now the single choke point for
// storage cleanup. /delete (soft) never touches R2.

const PurgeSchema = z.object({
  fileId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = PurgeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const fileId = parsed.data.fileId;

    // Must exist, be owned, AND currently trashed.
    const { data: root, error: loadErr } = await supabase
      .from("files")
      .select("id, deleted_at")
      .eq("id", fileId)
      .eq("owner_id", session.userId)
      .single();
    if (loadErr || !root) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!root.deleted_at) {
      return NextResponse.json({ error: "Not in trash" }, { status: 400 });
    }

    // Walk the subtree to gather storage keys before the cascade
    // removes the rows. A recursive CTE keeps this to one round-trip.
    const { data: subtree, error: subErr } = await supabase.rpc("subtree_storage_keys", {
      p_root: fileId,
      p_owner: session.userId,
    });
    if (subErr) {
      throw new Error(`Subtree lookup failed: ${subErr.message}`);
    }

    // rpc returns [{file_id, storage_key}, ...] including both the
    // files.storage_key (legacy single-blob) and file_chunks rows.
    const rows = (subtree || []) as { storage_key: string | null }[];
    const storageKeys = rows.map((r) => r.storage_key).filter((k): k is string => !!k);

    // R2 cleanup (best-effort). A failed delete here leaks storage
    // but must not block the DB purge.
    await Promise.all(
      storageKeys.map(async (key) => {
        try {
          await deleteBlob(key);
        } catch (err) {
          logError("files.purge.r2", err);
        }
      })
    );

    // DB delete. ON DELETE CASCADE on files → file_keys + file_chunks
    // does the rest, but we still need to scope by owner.
    const { error: delErr } = await supabase
      .from("files")
      .delete()
      .eq("id", fileId)
      .eq("owner_id", session.userId);
    if (delErr) {
      throw new Error(`Purge failed: ${delErr.message}`);
    }

    auditEvent({
      event: "files.purge",
      actorUserId: session.userId,
      targetFileId: fileId,
      detail: `${storageKeys.length} blobs`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.purge", err);
    return NextResponse.json({ error: "Purge failed" }, { status: 500 });
  }
}
