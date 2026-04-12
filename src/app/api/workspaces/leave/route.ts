import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const Schema = z.object({
  workspaceId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    // Can't leave if you're the owner
    const { data: mem } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", session.userId)
      .single();
    if (!mem) return NextResponse.json({ error: "Not a member" }, { status: 404 });
    if (mem.role === "owner") return NextResponse.json({ error: "Owner cannot leave. Delete the workspace instead." }, { status: 400 });

    // Remove membership
    await supabase.from("workspace_members").delete()
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", session.userId);

    // Remove file_keys on the root folder
    const { data: ws } = await supabase.from("workspaces").select("root_folder_id").eq("id", parsed.data.workspaceId).single();
    if (ws) {
      await supabase.from("file_keys").delete()
        .eq("file_id", ws.root_folder_id)
        .eq("user_id", session.userId);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("workspaces.leave", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
