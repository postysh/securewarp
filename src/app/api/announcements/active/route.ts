import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Announcements the current user should see: published, not expired,
 * and not yet dismissed by them. Returns newest-first so the banner
 * shows the freshest item at the top when multiple are live.
 *
 * Two round-trips on purpose so we don't need to hand-write a join
 * SQL statement; Supabase PostgREST's NOT-IN semantics are clean.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const nowIso = new Date().toISOString();

    const [liveQ, dismissedQ] = await Promise.all([
      supabase
        .from("announcements")
        .select("id, title, body, severity, published_at, expires_at")
        .not("published_at", "is", null)
        .order("published_at", { ascending: false }),
      supabase
        .from("announcement_dismissals")
        .select("announcement_id, dismissed_at")
        .eq("user_id", session.userId),
    ]);
    if (liveQ.error) throw liveQ.error;
    if (dismissedQ.error) throw dismissedQ.error;

    // Map each announcement id → latest dismissed_at. A dismissal only
    // counts against a live announcement if the user dismissed it
    // AFTER the announcement's current published_at. If the admin
    // republishes (published_at updates), prior dismissals are stale
    // and the user sees the announcement again.
    const dismissedAt = new Map<string, string>();
    for (const d of dismissedQ.data ?? []) {
      const prev = dismissedAt.get(d.announcement_id);
      if (!prev || prev < d.dismissed_at) dismissedAt.set(d.announcement_id, d.dismissed_at);
    }

    const active = (liveQ.data ?? []).filter((a) => {
      if (a.expires_at && a.expires_at < nowIso) return false;
      const dAt = dismissedAt.get(a.id);
      if (dAt && a.published_at && dAt >= a.published_at) return false;
      return true;
    });

    return NextResponse.json({ announcements: active });
  } catch (err) {
    logError("announcements.active", err);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}
