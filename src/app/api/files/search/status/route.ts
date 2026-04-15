import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * GET — return the user's `search_indexed_at` timestamp so the client
 *       can decide whether to run a backfill of existing files.
 *
 * POST — set `search_indexed_at = now()` after the client finishes
 *        backfilling. Idempotent.
 */

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data, error } = await supabase
      .from("users")
      .select("search_indexed_at")
      .eq("id", session.userId)
      .single();
    if (error) {
      logError("search.status.get", error);
      return NextResponse.json({ error: "Internal" }, { status: 500 });
    }
    return NextResponse.json({ indexedAt: data?.search_indexed_at ?? null });
  } catch (err) {
    logError("search.status.get", err);
    return NextResponse.json({ error: "Internal" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { error } = await supabase
      .from("users")
      .update({ search_indexed_at: new Date().toISOString() })
      .eq("id", session.userId);
    if (error) {
      logError("search.status.post", error);
      return NextResponse.json({ error: "Internal" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("search.status.post", err);
    return NextResponse.json({ error: "Internal" }, { status: 500 });
  }
}
