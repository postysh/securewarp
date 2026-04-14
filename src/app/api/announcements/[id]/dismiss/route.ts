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
    const { error } = await supabase
      .from("announcement_dismissals")
      .upsert(
        { announcement_id: id, user_id: session.userId },
        { onConflict: "announcement_id,user_id" }
      );
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    logError("announcements.dismiss", err);
    return NextResponse.json({ error: "Failed to dismiss" }, { status: 500 });
  }
}
