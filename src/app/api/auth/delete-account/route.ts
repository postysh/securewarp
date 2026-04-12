import { NextResponse } from "next/server";
import { getSession, deleteSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { deleteBlob } from "@/lib/db/r2";
import { auditEvent } from "@/lib/audit";
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

    // Collect all R2 storage keys before cascade-deleting the DB rows.
    const { data: files } = await supabase
      .from("files")
      .select("id, storage_key")
      .eq("owner_id", userId);
    const fileIds = (files || []).map((f) => f.id);

    let chunkKeys: string[] = [];
    if (fileIds.length > 0) {
      const { data: chunks } = await supabase
        .from("file_chunks")
        .select("storage_key")
        .in("file_id", fileIds);
      chunkKeys = (chunks || []).map((c) => c.storage_key as string);
    }

    const allKeys = [
      ...(files || [])
        .map((f) => f.storage_key as string | null)
        .filter((k): k is string => !!k),
      ...chunkKeys,
    ];

    // R2 cleanup — best-effort
    await Promise.all(
      allKeys.map(async (key) => {
        try {
          await deleteBlob(key);
        } catch (err) {
          logError("auth.delete-account.r2", err);
        }
      })
    );

    auditEvent({
      event: "auth.delete_account",
      actorUserId: userId,
      detail: `${allKeys.length} blobs`,
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
