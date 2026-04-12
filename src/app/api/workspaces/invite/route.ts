import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { getUserByEmail } from "@/lib/db/users";
import { grantFileAccess } from "@/lib/db/files";
import { normalizeEmail } from "@/lib/auth/email";
import { createNotification } from "@/lib/db/notifications";
import { logError } from "@/lib/log";

const InviteSchema = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().email(),
  // The client wraps the root folder's private hierarchical key
  // for the recipient — same as the existing share flow.
  encryptedPrivateHierarchicalKey: z.string().min(1),
  wrappedByPublicKey: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const parsed = InviteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    const { workspaceId, email: rawEmail, encryptedPrivateHierarchicalKey, wrappedByPublicKey } = parsed.data;
    const email = normalizeEmail(rawEmail);

    // Verify caller is the workspace owner
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.userId)
      .single();
    if (!membership || membership.role !== "owner") {
      return NextResponse.json({ error: "Only the workspace owner can invite" }, { status: 403 });
    }

    // Get workspace root folder
    const { data: ws } = await supabase
      .from("workspaces")
      .select("root_folder_id, name")
      .eq("id", workspaceId)
      .single();
    if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    // Find recipient
    const recipient = await getUserByEmail(email);
    if (!recipient) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (recipient.id === session.userId) {
      return NextResponse.json({ error: "You are already a member" }, { status: 400 });
    }

    // Grant file access to the root folder (Phase 3 inheritance
    // gives them access to everything inside automatically)
    await grantFileAccess({
      fileId: ws.root_folder_id,
      userId: recipient.id,
      encryptedPrivateHierarchicalKey,
      wrappedByPublicKey,
      permissionLevel: "editor",
    });

    // Add as workspace member
    const { error: memErr } = await supabase
      .from("workspace_members")
      .upsert(
        { workspace_id: workspaceId, user_id: recipient.id, role: "member" },
        { onConflict: "workspace_id,user_id" }
      );
    if (memErr) throw memErr;

    createNotification({
      userId: recipient.id,
      type: "file_shared",
      title: `Invited to ${ws.name}`,
      description: `${session.email} invited you to the ${ws.name} workspace`,
      fileId: ws.root_folder_id,
      actorUserId: session.userId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("workspaces.invite", err);
    return NextResponse.json({ error: "Invite failed" }, { status: 500 });
  }
}
