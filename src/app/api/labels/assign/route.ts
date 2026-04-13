import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { getEffectivePermission } from "@/lib/db/files";
import { logError } from "@/lib/log";

const Schema = z.object({
  fileId: z.string().uuid(),
  labelId: z.string().uuid(),
  action: z.enum(["add", "remove"]),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    // Verify the label belongs to this user
    const { data: label } = await supabase
      .from("labels")
      .select("id")
      .eq("id", parsed.data.labelId)
      .eq("user_id", session.userId)
      .single();
    if (!label) return NextResponse.json({ error: "Label not found" }, { status: 404 });

    // Verify the user has access to the target file
    const perm = await getEffectivePermission(parsed.data.fileId, session.userId);
    if (!perm) return NextResponse.json({ error: "File not found" }, { status: 404 });

    if (parsed.data.action === "add") {
      const { error } = await supabase
        .from("file_labels")
        .upsert({ file_id: parsed.data.fileId, label_id: parsed.data.labelId }, { onConflict: "file_id,label_id" });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("file_labels")
        .delete()
        .eq("file_id", parsed.data.fileId)
        .eq("label_id", parsed.data.labelId);
      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("labels.assign", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
