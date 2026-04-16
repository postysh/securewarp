import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { getUserByEmail } from "@/lib/db/users";
import { grantFileAccess } from "@/lib/db/files";
import { normalizeEmail } from "@/lib/auth/email";
import { createNotification, resolveActorLabel } from "@/lib/db/notifications";
import { auditEvent } from "@/lib/audit";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { logError } from "@/lib/log";

const InviteSchema = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["admin", "editor", "viewer"]).default("editor"),
  encryptedPrivateHierarchicalKey: z.string().min(1),
  wrappedByPublicKey: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await checkRateLimit(`ws:invite:${session.userId}`, 30))) {
      return NextResponse.json({ error: "Too many invites. Try again later." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = InviteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    const { workspaceId, email: rawEmail, encryptedPrivateHierarchicalKey, wrappedByPublicKey } = parsed.data;
    const email = normalizeEmail(rawEmail);

    // Verify caller is an admin
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.userId)
      .single();
    if (!membership || membership.role !== "admin") {
      return NextResponse.json({ error: "Only admins can invite members" }, { status: 403 });
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
    const filePermission = parsed.data.role === "viewer" ? "viewer" : "editor";
    await grantFileAccess({
      fileId: ws.root_folder_id,
      userId: recipient.id,
      encryptedPrivateHierarchicalKey,
      wrappedByPublicKey,
      permissionLevel: filePermission,
    });

    // Add as workspace member with the selected role
    const { error: memErr } = await supabase
      .from("workspace_members")
      .upsert(
        { workspace_id: workspaceId, user_id: recipient.id, role: parsed.data.role },
        { onConflict: "workspace_id,user_id" }
      );
    if (memErr) throw memErr;

    auditEvent({
      event: "workspace.invite",
      actorUserId: session.userId,
      targetUserId: recipient.id,
      targetFileId: ws.root_folder_id,
      detail: `${parsed.data.role}:${workspaceId}`,
    });

    const actorLabel = await resolveActorLabel(session.userId, session.email);
    createNotification({
      userId: recipient.id,
      type: "collaborator_joined",
      title: `Invited to ${ws.name}`,
      description: `${actorLabel} invited you to the ${ws.name} workspace`,
      fileId: ws.root_folder_id,
      actorUserId: session.userId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("workspaces.invite", err);
    return NextResponse.json({ error: "Invite failed" }, { status: 500 });
  }
}
