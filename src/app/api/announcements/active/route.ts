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
        .select("announcement_id")
        .eq("user_id", session.userId),
    ]);
    if (liveQ.error) throw liveQ.error;
    if (dismissedQ.error) throw dismissedQ.error;

    const dismissed = new Set((dismissedQ.data ?? []).map((r) => r.announcement_id));
    const active = (liveQ.data ?? []).filter((a) => {
      if (dismissed.has(a.id)) return false;
      if (a.expires_at && a.expires_at < nowIso) return false;
      return true;
    });

    return NextResponse.json({ announcements: active });
  } catch (err) {
    logError("announcements.active", err);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}
