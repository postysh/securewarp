import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Mark the current user as onboarded. Idempotent — calling this twice is
 * harmless; the second call is a no-op because the UPDATE only runs
 * against rows where onboarded_at IS NULL.
 */
export async function POST() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { error } = await supabase
      .from("users")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("id", session.userId)
      .is("onboarded_at", null);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("auth.onboarding.complete", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
