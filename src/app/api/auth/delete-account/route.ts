import { NextResponse } from "next/server";
import { getSession, deleteSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { deleteBlobs } from "@/lib/db/r2";
import { auditEvent } from "@/lib/audit";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { logError } from "@/lib/log";

// Permanent account deletion. Deletes all files (DB + R2), file_keys,
// file_links, notifications, SRP sessions, and the user row itself.
// ON DELETE CASCADE handles most relational cleanup; only R2 blobs
// need explicit removal since they're outside the DB.

export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.userId;

    // Belt-and-braces throttle. A stolen session shouldn't be able to
    // nuke an account without tripping the limiter first; legitimate
    // users click "Delete account" at most a few times in confusion.
    if (!(await checkRateLimit(`delete-account:${userId}`, 3))) {
      return NextResponse.json(
        { error: "Too many delete attempts. Try again later." },
        { status: 429 },
      );
    }

    // Collect all (shard, storage_key) pairs before cascade-deleting
    // the DB rows. The legacy `files.storage_key` branch is gone — the
    // single-blob upload path was removed; every file now lives on
    // file_chunks exclusively.
    const { data: files } = await supabase
      .from("files")
      .select("id")
      .eq("owner_id", userId);
    const fileIds = (files || []).map((f) => f.id);

    let orphanedChunks: { shard: number; storageKey: string }[] = [];
    if (fileIds.length > 0) {
      const { data: chunks } = await supabase
        .from("file_chunks")
        .select("storage_key, shard")
        .in("file_id", fileIds);
      orphanedChunks = (chunks || [])
        .filter((c) => !!c.storage_key)
        .map((c) => ({
          storageKey: c.storage_key as string,
          shard: (c.shard as number | null) ?? 0,
        }));
    }

    // R2 cleanup — best-effort; groups by shard internally.
    try {
      await deleteBlobs(orphanedChunks);
    } catch (err) {
      logError("auth.delete-account.r2", err);
    }

    auditEvent({
      event: "auth.delete_account",
      actorUserId: userId,
      detail: `${orphanedChunks.length} blobs`,
    });

    // Delete the user row — cascades to files, file_keys, file_chunks,
    // file_links, notifications, srp_sessions.
    const { error } = await supabase
      .from("users")
      .delete()
      .eq("id", userId);
    if (error) throw new Error(`Delete user failed: ${error.message}`);

    await deleteSession();

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("auth.delete-account", err);
    return NextResponse.json({ error: "Account deletion failed" }, { status: 500 });
  }
}
