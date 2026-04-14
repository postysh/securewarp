import { NextResponse } from "next/server";
import { safeCompare, utf8ToBytes } from "@/lib/auth/safe-compare";
import { supabase } from "@/lib/db/supabase";
import { deleteBlob } from "@/lib/db/r2";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

// Delete incomplete uploads older than this many hours. 24h gives legitimate
// resumable clients plenty of time while keeping orphan storage bounded.
const STALE_HOURS = 24;

function authorized(request: Request): boolean {
  // Accept either CLEANUP_SECRET (app-specific) or CRON_SECRET (what Vercel
  // automatically injects as a Bearer token on scheduled cron invocations).
  // Either may be set; both must be rejected if unset or too short.
  const candidates = [process.env.CLEANUP_SECRET, process.env.CRON_SECRET].filter(
    (v): v is string => typeof v === "string" && v.length >= 16
  );
  if (candidates.length === 0) return false;

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  const a = utf8ToBytes(token);

  for (const expected of candidates) {
    const b = utf8ToBytes(expected);
    if (safeCompare(a, b)) return true;
  }
  return false;
}

async function runCleanup(): Promise<NextResponse> {
  try {
    const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000).toISOString();

    // Find incomplete uploads past the cutoff. Folders have upload_complete=true
    // by default, so they're naturally excluded.
    const { data: stale, error: listErr } = await supabase
      .from("files")
      .select("id, storage_key")
      .eq("upload_complete", false)
      .lt("created_at", cutoff);

    if (listErr) throw listErr;

    let filesDeleted = 0;
    let blobsDeleted = 0;

    for (const file of stale ?? []) {
      // Collect every R2 key tied to this file (single blob + chunks).
      const keys: string[] = [];
      if (file.storage_key) keys.push(file.storage_key);

      const { data: chunks } = await supabase
        .from("file_chunks")
        .select("storage_key")
        .eq("file_id", file.id);

      for (const c of chunks ?? []) {
        if (c.storage_key) keys.push(c.storage_key);
      }

      // Delete R2 objects first. Failures are logged but don't block the
      // DB cleanup — worst case a future sweep picks them up by key pattern.
      const results = await Promise.allSettled(keys.map((k) => deleteBlob(k)));
      for (const r of results) {
        if (r.status === "fulfilled") blobsDeleted++;
        else logError("cleanup.deleteBlob", r.reason);
      }

      // Cascade deletes file_chunks and file_keys via FK ON DELETE CASCADE.
      const { error: delErr } = await supabase.from("files").delete().eq("id", file.id);
      if (delErr) {
        logError("cleanup.deleteFile", delErr);
        continue;
      }
      filesDeleted++;
    }

    // Opportunistic prune of expired rate limits and used-token rows so the
    // caller doesn't also need pg_cron for these smaller tables.
    await supabase.from("rate_limits").delete().lt("reset_at", new Date().toISOString());
    await supabase
      .from("used_recovery_tokens")
      .delete()
      .lt("expires_at", new Date().toISOString());

    // Log a heartbeat so the admin dashboard's health strip can surface
    // "last cleanup run" timestamps. Fire-and-forget; audit failures
    // must not break the cron response.
    auditEvent({
      event: "cleanup.run",
      detail: `source=stale-uploads files=${filesDeleted} blobs=${blobsDeleted}`,
    });

    return NextResponse.json({ filesDeleted, blobsDeleted });
  } catch (err) {
    logError("cleanup.stale", err);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runCleanup();
}

// Vercel Cron hits scheduled paths with GET by default, forwarding a Bearer
// token from CRON_SECRET. Supporting GET lets the cron in vercel.json fire
// without any manual wrapper.
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runCleanup();
}
