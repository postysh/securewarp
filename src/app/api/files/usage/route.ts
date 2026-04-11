import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { MAX_STORAGE_BYTES } from "@/lib/db/quota";
import { logError } from "@/lib/log";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("files")
      .select("size_bytes")
      .eq("owner_id", session.userId);

    if (error) throw error;

    const usedBytes = (data || []).reduce((sum: number, f: { size_bytes: number }) => sum + (f.size_bytes || 0), 0);

    return NextResponse.json({
      usedBytes,
      maxBytes: MAX_STORAGE_BYTES,
      fileCount: data?.length || 0,
    });
  } catch (err) {
    logError("files.usage", err);
    return NextResponse.json({ error: "Failed to get usage" }, { status: 500 });
  }
}
