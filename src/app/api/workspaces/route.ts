import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  // The client creates the root folder first (encrypted metadata,
  // hierarchical keys, etc.) then passes its ID here.
  rootFolderId: z.string().uuid(),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // All workspaces the user is a member of
    const { data, error } = await supabase
      .from("workspace_members")
      .select("role, workspace:workspaces!workspace_members_workspace_id_fkey(id, name, root_folder_id, owner_id)")
      .eq("user_id", session.userId);
    if (error) throw error;

    const workspaces = (data || []).map((row) => {
      const ws = (row.workspace as unknown) as { id: string; name: string; root_folder_id: string; owner_id: string };
      return {
        id: ws.id,
        name: ws.name,
        rootFolderId: ws.root_folder_id,
        ownerId: ws.owner_id,
        role: row.role,
      };
    });

    return NextResponse.json({ workspaces });
  } catch (err) {
    logError("workspaces.list", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    // Verify the root folder exists and is owned by this user
    const { data: folder } = await supabase
      .from("files")
      .select("id, is_folder, owner_id")
      .eq("id", parsed.data.rootFolderId)
      .eq("owner_id", session.userId)
      .single();
    if (!folder || !folder.is_folder) {
      return NextResponse.json({ error: "Root folder not found" }, { status: 404 });
    }

    // Create workspace
    const { data: ws, error: wsErr } = await supabase
      .from("workspaces")
      .insert({
        name: parsed.data.name,
        root_folder_id: parsed.data.rootFolderId,
        owner_id: session.userId,
      })
      .select("id")
      .single();
    if (wsErr) throw wsErr;

    // Add owner as first member
    const { error: memErr } = await supabase
      .from("workspace_members")
      .insert({
        workspace_id: ws.id,
        user_id: session.userId,
        role: "owner",
      });
    if (memErr) throw memErr;

    return NextResponse.json({ workspaceId: ws.id });
  } catch (err) {
    logError("workspaces.create", err);
    return NextResponse.json({ error: "Failed to create workspace" }, { status: 500 });
  }
}
