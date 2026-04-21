import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const BodySchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(500),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    const now = new Date().toISOString();
    const rows = parsed.data.fileIds.map((fileId) => ({
      user_id: session.userId,
      file_id: fileId,
      seen_at: now,
    }));

    // ignoreDuplicates so a later mark-seen never rewinds an earlier
    // timestamp. Matches the EARLIEST-wins merge in the client cache.
    const { error } = await supabase
      .from("user_file_seen")
      .upsert(rows, { onConflict: "user_id,file_id", ignoreDuplicates: true });
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.seen", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
