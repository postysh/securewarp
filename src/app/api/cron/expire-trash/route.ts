import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { deleteBlobs } from "@/lib/db/r2";
import { auditEventAwait } from "@/lib/audit";
import { safeCompare, utf8ToBytes } from "@/lib/auth/safe-compare";
import { logError } from "@/lib/log";

const TRASH_MAX_AGE_DAYS = 30;

// Daily cron (external scheduler hits POST with Bearer CRON_SECRET).
// Also supports GET so Vercel-style Bearer-injected schedulers work.
// Permanently deletes files trashed for more than 30 days including R2
// blobs, and prunes expired rate_limits + used_recovery_tokens rows.

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) return false;
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  return safeCompare(utf8ToBytes(token), utf8ToBytes(expected));
}

async function run(): Promise<NextResponse> {
  try {
    const cutoff = new Date(Date.now() - TRASH_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Find all files trashed before the cutoff
    const { data: expired, error: findErr } = await supabase
      .from("files")
      .select("id")
      .lt("deleted_at", cutoff)
      .not("deleted_at", "is", null);
    if (findErr) throw findErr;

    let fileIds: string[] = [];
    let orphanedChunks: { shard: number; storageKey: string }[] = [];
    if (expired && expired.length > 0) {
      fileIds = expired.map((f) => f.id);

      // Collect (shard, storage_key) for every chunk. Legacy
      // files.storage_key is gone.
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

      // R2 cleanup (best-effort, grouped by shard internally)
      try {
        await deleteBlobs(orphanedChunks);
      } catch (err) {
        logError("cron.expire-trash.r2", err);
      }

      // DB delete (cascades to file_keys, file_chunks)
      const { error: delErr } = await supabase
        .from("files")
        .delete()
        .in("id", fileIds);
      if (delErr) throw delErr;
    }

    // Prune expired rate limits and recovery tokens
    const { count: rlCount } = await supabase
      .from("rate_limits")
      .delete({ count: "exact" })
      .lt("reset_at", new Date().toISOString());

    const { count: rtCount } = await supabase
      .from("used_recovery_tokens")
      .delete({ count: "exact" })
      .lt("expires_at", new Date().toISOString());

    // Heartbeat for the admin health strip. Awaited — detached promises
    // get killed when Workers returns the response.
    await auditEventAwait({
      event: "cleanup.run",
      detail: `source=expire-trash purged=${fileIds.length} blobs=${orphanedChunks.length} rate_limits=${rlCount ?? 0} tokens=${rtCount ?? 0}`,
    });

    return NextResponse.json({
      purged: fileIds.length,
      blobs: orphanedChunks.length,
      pruned: { rateLimits: rlCount ?? 0, recoveryTokens: rtCount ?? 0 },
    });
  } catch (err) {
    logError("cron.expire-trash", err);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run();
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run();
}
