import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    // Verify caller is a member
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.userId)
      .single();
    if (!membership) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    const { data, error } = await supabase
      .from("workspace_members")
      .select("user_id, role, joined_at, user:users!workspace_members_user_id_fkey(email, display_name)")
      .eq("workspace_id", workspaceId)
      .order("joined_at");
    if (error) throw error;

    const members = (data || []).map((row) => {
      const user = (row.user as unknown) as { email: string; display_name: string | null } | null;
      return {
        userId: row.user_id,
        email: user?.email ?? "",
        displayName: user?.display_name ?? null,
        role: row.role,
        joinedAt: row.joined_at,
      };
    });

    return NextResponse.json({ members });
  } catch (err) {
    logError("workspaces.members", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
