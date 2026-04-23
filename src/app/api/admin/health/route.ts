import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * System health snapshot for the admin overview strip.
 *
 * Checks:
 *   - Supabase: round-trip ping via a trivial count query
 *   - R2: we don't ping R2 on every dashboard load (a signed PUT would
 *     cost something). Instead we report whether R2 creds are present;
 *     the signing path surfaces real errors when upload/download
 *     actually happen. If we later want a deeper check, a once-a-day
 *     cron can ping R2 and write a heartbeat row.
 *   - Cron heartbeats: latest `cleanup.run` rows per source (stale
 *     uploads, trash expiration). Surfaced so admins can tell at a
 *     glance if a scheduled job silently stopped firing.
 */
export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const nowMs = Date.now();

    // Supabase ping — a count on a tiny table. If this returns, DB is up.
    let supabaseOk = false;
    let supabaseLatencyMs: number | null = null;
    const t0 = Date.now();
    try {
      const { error } = await supabase.from("users").select("id", { count: "exact", head: true });
      supabaseOk = !error;
      supabaseLatencyMs = Date.now() - t0;
    } catch {
      supabaseOk = false;
    }

    // R2: creds present check only. The actual signing path validates
    // at upload/download time via the AwsClient constructor error flow.
    // Bucket names are derived per-shard from SHARD_COUNT in r2.ts, so
    // there's no R2_BUCKET env var to check.
    const r2Configured = Boolean(
      process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY &&
        process.env.R2_ENDPOINT
    );

    // Latest cron heartbeats — look for cleanup.run rows. `detail` carries
    // `source=stale-uploads` or `source=expire-trash` so we can split them.
    const { data: heartbeats } = await supabase
      .from("security_audit")
      .select("occurred_at, detail")
      .eq("event_type", "cleanup.run")
      .order("occurred_at", { ascending: false })
      .limit(20);

    let staleCleanupAt: string | null = null;
    let trashExpireAt: string | null = null;
    for (const row of heartbeats ?? []) {
      const detail = row.detail ?? "";
      if (!staleCleanupAt && detail.includes("source=stale-uploads")) {
        staleCleanupAt = row.occurred_at;
      }
      if (!trashExpireAt && detail.includes("source=expire-trash")) {
        trashExpireAt = row.occurred_at;
      }
      if (staleCleanupAt && trashExpireAt) break;
    }

    // Heuristic "stale" threshold: 36h (daily crons with 12h grace).
    const STALE_MS = 36 * 60 * 60 * 1000;
    const isFresh = (iso: string | null) =>
      iso != null && nowMs - new Date(iso).getTime() < STALE_MS;

    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      supabase: { ok: supabaseOk, latencyMs: supabaseLatencyMs },
      r2: { ok: r2Configured },
      crons: {
        cleanupStale: { lastRunAt: staleCleanupAt, fresh: isFresh(staleCleanupAt) },
        expireTrash: { lastRunAt: trashExpireAt, fresh: isFresh(trashExpireAt) },
      },
    });
  } catch (err) {
    logError("admin.health", err);
    return NextResponse.json({ error: "Failed to check health" }, { status: 500 });
  }
}
