import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Mark an announcement as dismissed for the current user. Idempotent —
 * re-dismissing an already-dismissed announcement is a no-op because
 * the PK is (announcement_id, user_id).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    // Explicitly set dismissed_at so a second dismiss (after the admin
    // republishes) refreshes the timestamp to "now". The active-
    // announcements filter compares dismissed_at >= published_at to
    // decide whether a dismissal still counts, so we want the latest
    // timestamp, not the original one from a prior publication.
    const { error } = await supabase
      .from("announcement_dismissals")
      .upsert(
        { announcement_id: id, user_id: session.userId, dismissed_at: new Date().toISOString() },
        { onConflict: "announcement_id,user_id" }
      );
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    logError("announcements.dismiss", err);
    return NextResponse.json({ error: "Failed to dismiss" }, { status: 500 });
  }
}
