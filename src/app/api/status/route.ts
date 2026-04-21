import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";

/**
 * Public status endpoint. Drives the marketing footer indicator.
 *
 * Visitors never trigger a live health check here — that's the
 * job of the hourly /api/cron/status-check which writes to
 * `system_status`. This route just reads the latest row back.
 * Two upshots:
 *   - Marketing pages scale to any visitor volume at O(1) per
 *     page view (one indexed row-read).
 *   - No attack surface: the endpoint exercises no third-party
 *     deps, returns a boolean, and never tells the visitor which
 *     service is red.
 *
 * If the latest row is stale (older than 2× the cron cadence,
 * e.g., cron is down), the endpoint reports "degraded" — a quiet
 * signal that something in our OWN pipeline is off.
 */

const STALE_AFTER_MS = 3 * 60 * 60 * 1000; // 3h — 2× hourly cron cadence + buffer

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("system_status")
      .select("ok, checked_at")
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // No rows yet (cron hasn't fired): treat as "checking" so the
    // UI can render grey instead of flashing red before the first
    // cron tick lands.
    if (error || !data) {
      const res = NextResponse.json({ ok: null });
      res.headers.set("Cache-Control", "public, max-age=60, s-maxage=60");
      return res;
    }

    const age = Date.now() - new Date(data.checked_at as string).getTime();
    const ok = data.ok === true && age < STALE_AFTER_MS;

    const res = NextResponse.json({ ok });
    // Edge cache is generous — the underlying row only changes
    // once an hour anyway. 5 minutes is a reasonable fresh window
    // that also limits origin load if a cron run is temporarily
    // delayed.
    res.headers.set("Cache-Control", "public, max-age=300, s-maxage=300");
    return res;
  } catch {
    // Suppress detail; render degraded.
    const res = NextResponse.json({ ok: false });
    res.headers.set("Cache-Control", "public, max-age=60, s-maxage=60");
    return res;
  }
}
