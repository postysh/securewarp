import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { getEffectivePermission } from "@/lib/db/files";
import { logError } from "@/lib/log";

const PinSchema = z.object({
  fileId: z.string().uuid(),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data, error } = await supabase
      .from("user_pins")
      .select("file_id, sort_order, file:files!user_pins_file_id_fkey(is_folder)")
      .eq("user_id", session.userId)
      .order("sort_order");
    if (error) throw error;

    const pins = (data || []).map((p) => ({
      file_id: p.file_id,
      sort_order: p.sort_order,
      is_folder: ((p.file as unknown) as { is_folder: boolean } | null)?.is_folder ?? false,
    }));

    return NextResponse.json({ pins });
  } catch (err) {
    logError("pins.list", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const parsed = PinSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    const perm = await getEffectivePermission(parsed.data.fileId, session.userId);
    if (!perm) return NextResponse.json({ error: "File not found" }, { status: 404 });

    const { error } = await supabase
      .from("user_pins")
      .upsert({ user_id: session.userId, file_id: parsed.data.fileId }, { onConflict: "user_id,file_id" });
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("pins.add", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const parsed = PinSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    const { error } = await supabase
      .from("user_pins")
      .delete()
      .eq("user_id", session.userId)
      .eq("file_id", parsed.data.fileId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("pins.remove", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
