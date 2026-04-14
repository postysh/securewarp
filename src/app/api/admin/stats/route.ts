import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Admin overview stats. Aggregates are computed live — volumes are small
 * enough (tens of thousands of users, maybe) that Postgres counts fine. If
 * this ever gets slow, cache in a materialized view refreshed hourly.
 */
export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const nowMs = Date.now();
    const sevenDaysAgo = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [
      totalUsersQ,
      newUsers7dQ,
      newUsers30dQ,
      activeUsers7dQ,
      suspendedUsersQ,
      totalFilesQ,
      storageRowsQ,
    ] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("users").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
      supabase.from("users").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgo),
      supabase.from("users").select("id", { count: "exact", head: true }).gte("last_login_at", sevenDaysAgo),
      supabase.from("users").select("id", { count: "exact", head: true }).not("suspended_at", "is", null),
      supabase.from("files").select("id", { count: "exact", head: true }).eq("upload_complete", true).is("deleted_at", null),
      supabase.from("files").select("size_bytes").eq("upload_complete", true).is("deleted_at", null),
    ]);

    // Client-side SUM — fine at small scale. If this ever exceeds a few
    // thousand files per query, swap for a plpgsql aggregate function.
    const totalBytes = (storageRowsQ.data ?? []).reduce(
      (s: number, f: { size_bytes: number | null }) => s + (f.size_bytes || 0),
      0
    );

    return NextResponse.json({
      totalUsers: totalUsersQ.count ?? 0,
      newUsers7d: newUsers7dQ.count ?? 0,
      newUsers30d: newUsers30dQ.count ?? 0,
      activeUsers7d: activeUsers7dQ.count ?? 0,
      suspendedUsers: suspendedUsersQ.count ?? 0,
      totalFiles: totalFilesQ.count ?? 0,
      totalBytes,
    });
  } catch (err) {
    logError("admin.stats", err);
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 });
  }
}
