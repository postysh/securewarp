import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { getTier } from "@/lib/billing/customers";
import { limitsForTier } from "@/lib/billing/config";
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

    // All workspaces the user is a member of. Includes security
    // policy fields so the client can render the `lockedByTwoFactor`
    // state on each row without an extra round-trip.
    const { data, error } = await supabase
      .from("workspace_members")
      .select(
        "role, workspace:workspaces!workspace_members_workspace_id_fkey(" +
          "id, name, root_folder_id, owner_id, color, description, default_role, " +
          "require_2fa, links_disabled, links_require_password, links_max_expiry_days" +
          ")",
      )
      .eq("user_id", session.userId);
    if (error) throw error;

    // Fetch the caller's TOTP state once; used to compute the
    // `lockedByTwoFactor` flag per workspace.
    const { data: me } = await supabase
      .from("users")
      .select("totp_secret")
      .eq("id", session.userId)
      .single();
    const hasTotp = Boolean(me?.totp_secret);

    const workspaces = ((data || []) as unknown as Array<{
      role: string;
      workspace: {
        id: string; name: string; root_folder_id: string; owner_id: string;
        color: string; description: string; default_role: string;
        require_2fa: boolean;
        links_disabled: boolean;
        links_require_password: boolean;
        links_max_expiry_days: number | null;
      };
    }>).map((row) => {
      const ws = row.workspace;
      return {
        id: ws.id,
        name: ws.name,
        rootFolderId: ws.root_folder_id,
        ownerId: ws.owner_id,
        color: ws.color,
        description: ws.description,
        defaultRole: ws.default_role,
        role: row.role,
        require2fa: ws.require_2fa,
        linksDisabled: ws.links_disabled,
        linksRequirePassword: ws.links_require_password,
        linksMaxExpiryDays: ws.links_max_expiry_days,
        // True when the workspace demands 2FA and the caller hasn't
        // enabled TOTP yet. Client shows a lock badge on the switcher
        // row; actual file-op blocking is a follow-up.
        lockedByTwoFactor: ws.require_2fa && !hasTotp,
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

    // Enforce the caller's tier cap on workspace count. Free allows
    // 1, Plus/Pro are unlimited (TIER_LIMITS uses Infinity).
    const [{ count: existingCount }, tier] = await Promise.all([
      supabase
        .from("workspaces")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", session.userId),
      getTier(session.userId),
    ]);
    const cap = limitsForTier(tier).workspaces;
    if ((existingCount ?? 0) >= cap) {
      return NextResponse.json(
        {
          error:
            tier === "free"
              ? "Free tier allows one workspace. Upgrade to Plus or Pro for unlimited."
              : "Workspace limit reached for your plan.",
          code: "workspace_limit",
        },
        { status: 402 },
      );
    }

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

    // Mark the folder as a workspace root (hidden from personal, protected from delete)
    await supabase.from("files").update({ is_workspace_root: true }).eq("id", parsed.data.rootFolderId);

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
        role: "admin",
      });
    if (memErr) throw memErr;

    return NextResponse.json({ workspaceId: ws.id });
  } catch (err) {
    logError("workspaces.create", err);
    return NextResponse.json({ error: "Failed to create workspace" }, { status: 500 });
  }
}
