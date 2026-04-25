import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("changelog_entries")
      .select("id, title, body, category, published_at")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return NextResponse.json(
      { entries: data ?? [] },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (err) {
    logError("changelog.public", err);
    return NextResponse.json({ error: "Failed to load changelog" }, { status: 500 });
  }
}
