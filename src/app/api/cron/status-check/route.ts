import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { safeCompare, utf8ToBytes } from "@/lib/auth/safe-compare";
import { logError } from "@/lib/log";

/**
 * Hourly cron — writes one `system_status` row reflecting current
 * dependency health. The marketing footer reads the LATEST row
 * only, so visitors never trigger a live health check and the
 * dashboard scales to any traffic volume at a flat cost of one
 * cheap row-read per page view.
 *
 * Also prunes rows older than 4 days to keep the table tiny.
 *
 * Called from cron-job.org with `Authorization: Bearer <CRON_SECRET>`.
 * GET accepted too so any bare-URL scheduler can invoke it.
 */

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) return false;
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  return safeCompare(utf8ToBytes(token), utf8ToBytes(expected));
}

const CHECK_TIMEOUT_MS = 5_000;
const RETENTION_DAYS = 4;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);
}

async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  try {
    const result = await withTimeout(
      Promise.resolve(
        supabase.from("users").select("id", { count: "exact", head: true }).limit(1),
      ),
      CHECK_TIMEOUT_MS,
    );
    const latencyMs = Date.now() - started;
    return { ok: !result.error, latencyMs };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
}

async function run(): Promise<NextResponse> {
  try {
    // Health check — just DB reachability for now. A DB-down
    // deployment can't serve anything useful, so flat-green on
    // DB-green is an honest proxy for "site works."
    const { ok, latencyMs } = await pingDatabase();

    const { error: insertErr } = await supabase.from("system_status").insert({
      ok,
      latency_ms: latencyMs,
    });
    if (insertErr) throw insertErr;

    // Prune rows older than retention. Cheap because of the index
    // on checked_at DESC.
    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { error: pruneErr } = await supabase
      .from("system_status")
      .delete()
      .lt("checked_at", cutoff);
    if (pruneErr) logError("cron.status-check.prune", pruneErr);

    return NextResponse.json({ ok, latencyMs });
  } catch (err) {
    logError("cron.status-check", err);
    return NextResponse.json({ error: "Status check failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}
