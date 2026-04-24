import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { getPg } from "@/lib/db/pg";
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
  const pg = getPg();
  let row: {
    display_name: string | null;
    notification_prefs: Record<string, boolean> | null;
    onboarded_at: string | null;
    totp_secret: string | null;
    srp_salt: string | null;
    argon2_salt: string | null;
  } | undefined;

  if (pg) {
    const rows = await pg<Array<{
      display_name: string | null;
      notification_prefs: Record<string, boolean> | null;
      onboarded_at: string | null;
      totp_secret: string | null;
      srp_salt: string | null;
      argon2_salt: string | null;
    }>>`
      SELECT display_name, notification_prefs, onboarded_at, totp_secret, srp_salt, argon2_salt
      FROM users WHERE id = ${userId} LIMIT 1
    `;
    row = rows[0];
  } else {
    const { data, error } = await supabase
      .from("users")
      .select("display_name, notification_prefs, onboarded_at, totp_secret, srp_salt, argon2_salt")
      .eq("id", userId)
      .single();
    if (error) throw error;
    row = data ?? undefined;
  }
  return {
    displayName: row?.display_name ?? "",
    notificationPrefs: row?.notification_prefs ?? {
      file_shared: true,
      file_unshared: true,
      permission_changed: true,
      collaborator_joined: true,
      workspace_transferred: true,
      billing_receipts: true,
      billing_renewal_reminder: true,
    },
    onboarded: row?.onboarded_at != null,
    totpEnabled: Boolean(row?.totp_secret),
    srpSalt: row?.srp_salt ?? null,
    argon2Salt: row?.argon2_salt ?? null,
  };
}

async function loadPins(userId: string) {
  const pg = getPg();
  if (pg) {
    // One-shot join via direct SQL — beats supabase-js's REST
    // embed, which issues an N+1 fetch for the embedded relation.
    const rows = await pg<Array<{ file_id: string; sort_order: number; is_folder: boolean }>>`
      SELECT p.file_id, p.sort_order, f.is_folder
      FROM user_pins p
      JOIN files f ON f.id = p.file_id
      WHERE p.user_id = ${userId}
      ORDER BY p.sort_order
    `;
    return rows.map((r) => ({
      file_id: r.file_id,
      sort_order: r.sort_order,
      is_folder: r.is_folder,
    }));
  }
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
  const pg = getPg();
  if (pg) {
    const rows = await pg<Array<{ id: string; name: string; color: string; sort_order: number }>>`
      SELECT id, name, color, sort_order
      FROM labels WHERE user_id = ${userId} ORDER BY sort_order
    `;
    return rows;
  }
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
  const pg = getPg();
  if (pg) {
    // Push the aggregation into Postgres — one row per bucket
    // instead of shipping every file's size_bytes back to the
    // Worker and summing client-side. On large owners (thousands
    // of files) this is the single biggest win in /api/boot.
    const rows = await pg<Array<{
      files_bytes: string;
      trash_bytes: string;
      files_count: string;
      trash_count: string;
    }>>`
      SELECT
        COALESCE(SUM(CASE WHEN deleted_at IS NULL THEN size_bytes END), 0)::text AS files_bytes,
        COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL THEN size_bytes END), 0)::text AS trash_bytes,
        COALESCE(COUNT(CASE WHEN deleted_at IS NULL THEN 1 END), 0)::text AS files_count,
        COALESCE(COUNT(CASE WHEN deleted_at IS NOT NULL THEN 1 END), 0)::text AS trash_count
      FROM files
      WHERE owner_id = ${userId} AND upload_complete = true
    `;
    const r = rows[0];
    const filesBytes = r ? Number(r.files_bytes) : 0;
    const trashBytes = r ? Number(r.trash_bytes) : 0;
    const filesCount = r ? Number(r.files_count) : 0;
    const trashCount = r ? Number(r.trash_count) : 0;
    return {
      filesBytes,
      filesCount,
      trashBytes,
      trashCount,
      usedBytes: filesBytes + trashBytes,
    };
  }
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
  const pg = getPg();
  if (pg) {
    const rows = await pg<Array<{
      role: string;
      id: string; name: string; root_folder_id: string; owner_id: string;
      color: string; description: string; default_role: string;
      require_2fa: boolean;
      links_disabled: boolean;
      links_require_password: boolean;
      links_max_expiry_days: number | null;
    }>>`
      SELECT
        m.role,
        w.id, w.name, w.root_folder_id, w.owner_id, w.color, w.description,
        w.default_role, w.require_2fa, w.links_disabled,
        w.links_require_password, w.links_max_expiry_days
      FROM workspace_members m
      JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ${userId}
    `;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      rootFolderId: r.root_folder_id,
      ownerId: r.owner_id,
      color: r.color,
      description: r.description,
      defaultRole: r.default_role,
      role: r.role,
      require2fa: r.require_2fa,
      linksDisabled: r.links_disabled,
      linksRequirePassword: r.links_require_password,
      linksMaxExpiryDays: r.links_max_expiry_days,
    }));
  }
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
  const pg = getPg();
  if (pg) {
    const rows = await pg<Array<{ totp_secret: string | null }>>`
      SELECT totp_secret FROM users WHERE id = ${userId} LIMIT 1
    `;
    return Boolean(rows[0]?.totp_secret);
  }
  const { data } = await supabase
    .from("users")
    .select("totp_secret")
    .eq("id", userId)
    .single();
  return Boolean(data?.totp_secret);
}
