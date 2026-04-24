import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { getEntitlements } from "@/lib/billing/customers";
import { channelForUser, channelForWorkspace } from "@/lib/realtime/channels";
import { logError } from "@/lib/log";

/**
 * Shell-bootstrap aggregator. Opening /drive used to fire a wave of
 * independent fetches on mount — profile, usage, billing-ish entitlements,
 * pins, labels, workspaces, realtime tokens — each its own round-trip,
 * each the same `getSession()` cost, each a separate TLS handshake
 * from the browser's perspective. This route runs all of them in
 * parallel inside one Worker invocation and returns the shape the
 * client shell needs to render.
 *
 * Individual endpoints stay in place for refreshes (e.g. when a user
 * adds a pin or a label) — this is just the cold-start fast path.
 *
 * Intentionally does NOT include the file list or billing-status. File
 * list depends on viewMode which the user picks per session (/api/files
 * /list handles its own caching). Billing-status is a separate heavier
 * endpoint used by the Plan panel, not the drive shell.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.userId;

    // Fire every read in parallel. Each handler below mirrors a
    // subset of what its dedicated route returns — just the fields
    // the shell actually needs. No error leaks cross queries: one
    // failing query returns null for its slot; the rest still load.
    const [
      profile,
      entitlements,
      pins,
      labels,
      usage,
      workspaces,
      me,
    ] = await Promise.all([
      loadProfile(userId).catch((e) => {
        logError("boot.profile", e);
        return null;
      }),
      getEntitlements(userId).catch((e) => {
        logError("boot.entitlements", e);
        return null;
      }),
      loadPins(userId).catch((e) => {
        logError("boot.pins", e);
        return [];
      }),
      loadLabels(userId).catch((e) => {
        logError("boot.labels", e);
        return [];
      }),
      loadUsage(userId).catch((e) => {
        logError("boot.usage", e);
        return null;
      }),
      loadWorkspaces(userId).catch((e) => {
        logError("boot.workspaces", e);
        return [];
      }),
      loadTotpFlag(userId).catch(() => false),
    ]);

    // Workspace channels depend on the workspaces list — mint them
    // here so the client doesn't need to re-hit /api/realtime/tokens
    // right after parsing the boot response.
    const userChannel = channelForUser(userId);
    const workspaceChannels = workspaces.map((w) => ({
      workspaceId: w.id,
      channel: channelForWorkspace(w.id),
    }));

    // Finish the workspace rows with `lockedByTwoFactor` now that we
    // know the caller's TOTP state — same field /api/workspaces
    // returns, computed here instead of a second join.
    const hasTotp = me;
    const workspacesWithLocks = workspaces.map((w) => ({
      ...w,
      lockedByTwoFactor: w.require2fa && !hasTotp,
    }));

    return NextResponse.json({
      profile,
      entitlements,
      pins,
      labels,
      usage,
      workspaces: workspacesWithLocks,
      realtime: { userChannel, workspaceChannels },
    });
  } catch (err) {
    logError("boot", err);
    return NextResponse.json({ error: "Failed to boot" }, { status: 500 });
  }
}

async function loadProfile(userId: string) {
  const { data, error } = await supabase
    .from("users")
    .select("display_name, notification_prefs, onboarded_at, totp_secret, srp_salt, argon2_salt")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return {
    displayName: data?.display_name ?? "",
    notificationPrefs: data?.notification_prefs ?? {
      file_shared: true,
      file_unshared: true,
      permission_changed: true,
      collaborator_joined: true,
      workspace_transferred: true,
      billing_receipts: true,
      billing_renewal_reminder: true,
    },
    onboarded: data?.onboarded_at != null,
    totpEnabled: Boolean(data?.totp_secret),
    srpSalt: data?.srp_salt ?? null,
    argon2Salt: data?.argon2_salt ?? null,
  };
}

async function loadPins(userId: string) {
  const { data, error } = await supabase
    .from("user_pins")
    .select("file_id, sort_order, file:files!user_pins_file_id_fkey(is_folder)")
    .eq("user_id", userId)
    .order("sort_order");
  if (error) throw error;
  return (data || []).map((p) => ({
    file_id: p.file_id as string,
    sort_order: p.sort_order as number,
    is_folder: ((p.file as unknown) as { is_folder: boolean } | null)?.is_folder ?? false,
  }));
}

async function loadLabels(userId: string) {
  const { data, error } = await supabase
    .from("labels")
    .select("id, name, color, sort_order")
    .eq("user_id", userId)
    .order("sort_order");
  if (error) throw error;
  return data || [];
}

async function loadUsage(userId: string) {
  // Mirror /api/files/usage but skip the Stripe sync — boot needs to
  // be fast and the Plan panel already refetches via /api/files/usage
  // when opened, which does the sync. Serving last-known numbers on
  // boot is fine.
  const { data, error } = await supabase
    .from("files")
    .select("size_bytes, deleted_at")
    .eq("owner_id", userId)
    .eq("upload_complete", true);
  if (error) throw error;

  const rows = data || [];
  let filesBytes = 0;
  let trashBytes = 0;
  let filesCount = 0;
  let trashCount = 0;
  for (const f of rows) {
    const size = (f as { size_bytes: number }).size_bytes || 0;
    if ((f as { deleted_at: string | null }).deleted_at) {
      trashBytes += size;
      trashCount++;
    } else {
      filesBytes += size;
      filesCount++;
    }
  }
  return {
    filesBytes,
    filesCount,
    trashBytes,
    trashCount,
    usedBytes: filesBytes + trashBytes,
  };
}

async function loadWorkspaces(userId: string) {
  const { data, error } = await supabase
    .from("workspace_members")
    .select(
      "role, workspace:workspaces!workspace_members_workspace_id_fkey(" +
        "id, name, root_folder_id, owner_id, color, description, default_role, " +
        "require_2fa, links_disabled, links_require_password, links_max_expiry_days" +
        ")",
    )
    .eq("user_id", userId);
  if (error) throw error;

  return ((data || []) as unknown as Array<{
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
    };
  });
}

async function loadTotpFlag(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("users")
    .select("totp_secret")
    .eq("id", userId)
    .single();
  return Boolean(data?.totp_secret);
}
