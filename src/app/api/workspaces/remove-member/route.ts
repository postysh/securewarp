import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const Schema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    // Owner check
    const { data: mem } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", session.userId)
      .single();
    if (!mem || mem.role !== "owner") {
      return NextResponse.json({ error: "Only the owner can remove members" }, { status: 403 });
    }

    // Can't remove yourself (use delete workspace instead)
    if (parsed.data.userId === session.userId) {
      return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
    }

    // Remove membership
    await supabase.from("workspace_members").delete()
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", parsed.data.userId);

    // Remove file_keys on the root folder
    const { data: ws } = await supabase.from("workspaces").select("root_folder_id").eq("id", parsed.data.workspaceId).single();
    if (ws) {
      await supabase.from("file_keys").delete()
        .eq("file_id", ws.root_folder_id)
        .eq("user_id", parsed.data.userId);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("workspaces.remove-member", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
