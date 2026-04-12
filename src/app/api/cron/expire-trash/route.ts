import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { deleteBlob } from "@/lib/db/r2";
import { logError } from "@/lib/log";

const TRASH_MAX_AGE_DAYS = 30;

// Vercel Cron calls this daily. Permanently deletes all files that
// have been in trash for more than 30 days, including R2 blobs.
// Also prunes expired rate_limits and used_recovery_tokens rows.

export async function GET(request: Request) {
  // Verify the request is from Vercel Cron (not a random caller)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - TRASH_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Find all files trashed before the cutoff
    const { data: expired, error: findErr } = await supabase
      .from("files")
      .select("id, storage_key, owner_id")
      .lt("deleted_at", cutoff)
      .not("deleted_at", "is", null);
    if (findErr) throw findErr;
    if (!expired || expired.length === 0) {
      return NextResponse.json({ purged: 0, pruned: { rateLimits: 0, recoveryTokens: 0 } });
    }

    const fileIds = expired.map((f) => f.id);

    // Collect chunk storage keys
    const { data: chunks } = await supabase
      .from("file_chunks")
      .select("storage_key")
      .in("file_id", fileIds);

    const storageKeys = [
      ...expired.map((f) => f.storage_key).filter((k): k is string => !!k),
      ...((chunks || []).map((c) => c.storage_key as string)),
    ];

    // R2 cleanup (best-effort)
    await Promise.all(
      storageKeys.map(async (key) => {
        try { await deleteBlob(key); } catch (err) { logError("cron.expire-trash.r2", err); }
      })
    );

    // DB delete (cascades to file_keys, file_chunks)
    const { error: delErr } = await supabase
      .from("files")
      .delete()
      .in("id", fileIds);
    if (delErr) throw delErr;

    // Prune expired rate limits and recovery tokens
    const { count: rlCount } = await supabase
      .from("rate_limits")
      .delete({ count: "exact" })
      .lt("reset_at", new Date().toISOString());

    const { count: rtCount } = await supabase
      .from("used_recovery_tokens")
      .delete({ count: "exact" })
      .lt("expires_at", new Date().toISOString());

    return NextResponse.json({
      purged: fileIds.length,
      blobs: storageKeys.length,
      pruned: { rateLimits: rlCount ?? 0, recoveryTokens: rtCount ?? 0 },
    });
  } catch (err) {
    logError("cron.expire-trash", err);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}
