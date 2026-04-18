import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { getUserByEmail } from "@/lib/db/users";
import { grantFileAccess } from "@/lib/db/files";
import { normalizeEmail } from "@/lib/auth/email";
import { createNotification, resolveActorLabel } from "@/lib/db/notifications";
import { getTier } from "@/lib/billing/customers";
import { limitsForTier } from "@/lib/billing/config";
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

    // Get workspace root folder + owner (owner bears the seat cost)
    const { data: ws } = await supabase
      .from("workspaces")
      .select("root_folder_id, name, owner_id")
      .eq("id", workspaceId)
      .single();
    if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    // Find recipient (moved before seat-cap check so we can tell if
    // the invite is a no-op — inviting someone already in the owner's
    // seat set doesn't grow the count).
    const recipient = await getUserByEmail(email);
    if (!recipient) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (recipient.id === session.userId) {
      return NextResponse.json({ error: "You are already a member" }, { status: 400 });
    }

    // Seat cap is enforced against the workspace OWNER's tier, since
    // the owner bears the cost of every member across their
    // workspaces. Free=1, Plus=3, Pro=10. Owner counts as 1.
    const ownerId = ws.owner_id as string;
    const ownerTier = await getTier(ownerId);
    const cap = limitsForTier(ownerTier).seats;
    const { data: ownerWs } = await supabase
      .from("workspaces")
      .select("id")
      .eq("owner_id", ownerId);
    const wsIds = (ownerWs ?? []).map((w) => w.id as string);
    const { data: currentMembers } = wsIds.length > 0
      ? await supabase
          .from("workspace_members")
          .select("user_id")
          .in("workspace_id", wsIds)
      : { data: [] as { user_id: string }[] };
    const distinct = new Set((currentMembers ?? []).map((m) => m.user_id as string));
    distinct.add(ownerId);
    // Inviting someone already counted is a no-op; only grow the
    // count if they'd be new to this owner's seat set.
    const wouldBe = distinct.has(recipient.id) ? distinct.size : distinct.size + 1;
    if (wouldBe > cap) {
      return NextResponse.json(
        {
          error:
            ownerTier === "free"
              ? "Free tier is one user. The workspace owner must upgrade to invite members."
              : `Seat limit reached for the ${ownerTier} plan. Upgrade for more.`,
          code: "seat_limit",
        },
        { status: 402 },
      );
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
