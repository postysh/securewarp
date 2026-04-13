import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { auditEvent } from "@/lib/audit";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { createNotification } from "@/lib/db/notifications";
import { logError } from "@/lib/log";

const Schema = z.object({
  workspaceId: z.string().uuid(),
  newOwnerId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await checkRateLimit(`ws:transfer:${session.userId}`, 5))) {
      return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    const { workspaceId, newOwnerId } = parsed.data;

    if (newOwnerId === session.userId) {
      return NextResponse.json({ error: "You already own this workspace" }, { status: 400 });
    }

    // Verify caller is the workspace owner (owner_id on workspaces table)
    const { data: ws } = await supabase
      .from("workspaces")
      .select("owner_id, root_folder_id")
      .eq("id", workspaceId)
      .single();
    if (!ws || ws.owner_id !== session.userId) {
      return NextResponse.json({ error: "Only the workspace owner can transfer ownership" }, { status: 403 });
    }

    // Verify new owner is an admin member
    const { data: newOwnerMem } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", newOwnerId)
      .single();
    if (!newOwnerMem || newOwnerMem.role !== "admin") {
      return NextResponse.json({ error: "New owner must be an admin member" }, { status: 400 });
    }

    // Transfer: update workspace owner_id
    const { error: wsErr } = await supabase
      .from("workspaces")
      .update({ owner_id: newOwnerId })
      .eq("id", workspaceId);
    if (wsErr) throw wsErr;

    // Transfer ownership of the root folder
    const { error: rootErr } = await supabase
      .from("files")
      .update({ owner_id: newOwnerId })
      .eq("id", ws.root_folder_id);
    if (rootErr) throw rootErr;

    auditEvent({
      event: "files.permission_change",
      actorUserId: session.userId,
      targetUserId: newOwnerId,
      detail: `workspace.transfer:${workspaceId}`,
    });

    createNotification({
      userId: newOwnerId,
      type: "file_shared",
      title: "Workspace ownership transferred",
      description: `${session.email} transferred workspace ownership to you`,
      actorUserId: session.userId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("workspaces.transfer", err);
    return NextResponse.json({ error: "Transfer failed" }, { status: 500 });
  }
}
