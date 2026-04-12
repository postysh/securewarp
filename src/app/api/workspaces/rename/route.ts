import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const Schema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
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
      return NextResponse.json({ error: "Only the owner can rename" }, { status: 403 });
    }

    const { error } = await supabase
      .from("workspaces")
      .update({ name: parsed.data.name })
      .eq("id", parsed.data.workspaceId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("workspaces.rename", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
