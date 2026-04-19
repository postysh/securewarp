"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Logout01Icon from "@hugeicons/core-free-icons/Logout01Icon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
// Sidebar tab icons — match the main Settings modal's pattern
// (Setting07 for general, UserGroup for members, Analytics for
// overview, Alert for the irreversible actions).
import Setting07Icon from "@hugeicons/core-free-icons/Setting07Icon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import AnalyticsUpIcon from "@hugeicons/core-free-icons/AnalyticsUpIcon";
import Alert01Icon from "@hugeicons/core-free-icons/Alert01Icon";
import SecurityLockIcon from "@hugeicons/core-free-icons/SecurityLockIcon";
import { ConfirmDialog } from "./confirm-dialog";
import { RoleDropdown } from "./role-dropdown";
import { userLabel, userInitials, userColor } from "@/lib/display";

interface WorkspaceSettingsProps {
  open: boolean;
  onClose: () => void;
  workspace: {
    id: string;
    rootFolderId: string;
    name: string;
    role: string;
    color?: string;
    description?: string;
    defaultRole?: string;
    ownerId?: string;
    require2fa?: boolean;
    linksDisabled?: boolean;
    linksRequirePassword?: boolean;
    linksMaxExpiryDays?: number | null;
  } | null;
  onDeleted: () => void;
  onUpdated?: () => void;
}

const PRESET_COLORS = [
  "var(--accent-green-primary)",
  "var(--accent-blue-primary)",
  "var(--accent-pink-primary)",
  "var(--accent-orange-primary)",
  "var(--accent-yellow-primary)",
  "var(--accent-red-primary)",
];

const COLOR_NAMES: Record<string, string> = {
  "var(--accent-green-primary)": "Coral",
  "var(--accent-blue-primary)": "Blue",
  "var(--accent-pink-primary)": "Pink",
  "var(--accent-orange-primary)": "Orange",
  "var(--accent-yellow-primary)": "Yellow",
  "var(--accent-red-primary)": "Red",
};

const ROLES = ["admin", "editor", "viewer"] as const;
const ROLE_LABELS: Record<string, string> = { admin: "Admin", editor: "Editor", viewer: "Viewer" };

type TabId = "general" | "members" | "overview" | "security" | "danger";

const TABS: {
  id: TabId;
  label: string;
  icon: typeof Setting07Icon;
}[] = [
  { id: "overview", label: "Overview", icon: AnalyticsUpIcon },
  { id: "general", label: "General", icon: Setting07Icon },
  { id: "members", label: "Members", icon: UserGroupIcon },
  { id: "security", label: "Security", icon: SecurityLockIcon },
  { id: "danger", label: "Danger zone", icon: Alert01Icon },
];

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return iso.slice(0, 10);
}

/** Human-readable label for the compact Overview activity feed.
 *  We deliberately don't decrypt filenames in this snapshot
 *  (heavy; requires session-storage keys + async unwrap) — the
 *  dedicated activity modal already does that. Here we stick to
 *  the action + actor + relative time.
 */
function activityLabel(type: string): string {
  switch (type) {
    case "files.share": return "shared a file";
    case "files.unshare": return "unshared a file";
    case "files.leave": return "left a shared file";
    case "files.permission_change": return "changed file permissions";
    case "files.delete": return "moved a file to trash";
    case "files.rename": return "renamed a file";
    case "files.move": return "moved a file";
    case "files.restore": return "restored a file";
    case "files.purge": return "purged a file";
    case "files.rotate": return "rotated file keys";
    case "files.version_create": return "uploaded a new version";
    case "files.version_restore": return "restored an older version";
    case "files.version_delete": return "deleted a version";
    case "link.create": return "created a public link";
    case "link.revoke": return "revoked a public link";
    case "link.access.anon": return "link was opened";
    case "workspace.invite": return "invited a member";
    case "workspace.remove": return "removed a member";
    case "workspace.role_change": return "changed a member role";
    case "workspace.leave": return "left the workspace";
    default: return type.replaceAll(".", " ");
  }
}

export function WorkspaceSettings({ open, onClose, workspace, onDeleted, onUpdated }: WorkspaceSettingsProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [wsName, setWsName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [wsColor, setWsColor] = useState("var(--accent-green-primary)");
  const [wsDescription, setWsDescription] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [wsDefaultRole, setWsDefaultRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<{ userId: string; email: string } | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [adminMembers, setAdminMembers] = useState<{ userId: string; email: string; displayName?: string | null }[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  // Security policy — mirrors the columns on the workspaces row.
  // Initialized from the workspace prop on open; updates are
  // optimistic with rollback on API failure.
  const [require2fa, setRequire2fa] = useState(false);
  const [linksDisabled, setLinksDisabled] = useState(false);
  const [linksRequirePassword, setLinksRequirePassword] = useState(false);
  const [linksMaxExpiryDays, setLinksMaxExpiryDays] = useState<number | null>(null);
  const [linksMaxExpiryDraft, setLinksMaxExpiryDraft] = useState("");
  const [maxExpiryError, setMaxExpiryError] = useState<string | null>(null);
  // Inline admin overview — stats block + member list.
  const [stats, setStats] = useState<{
    fileCount: number;
    totalBytes: number;
    memberCount: number;
    lastActivityAt: string | null;
    createdAt: string | null;
    ownerEmail: string | null;
    ownerDisplayName: string | null;
    require2fa: boolean;
    linksDisabled: boolean;
    linksRequirePassword: boolean;
    linksMaxExpiryDays: number | null;
  } | null>(null);
  const [members, setMembers] = useState<
    { userId: string; email: string; displayName?: string | null; role: string }[]
  >([]);
  // Recent activity snapshot for the Overview tab. Admin-only on
  // the server (activity endpoint rejects non-admins) — so we
  // gate the fetch + render on isAdmin too.
  const [activity, setActivity] = useState<
    {
      id: string;
      type: string;
      actorEmail: string | null;
      actorDisplayName: string | null;
      detail: string | null;
      createdAt: string;
    }[]
  >([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const myEmail = (() => {
    try {
      return JSON.parse(sessionStorage.getItem("securewarp_keys") || "{}").email || "";
    } catch {
      return "";
    }
  })();
  const isAdmin = workspace?.role === "admin";
  // Tracks whether the modal is in a single open-and-alive session.
  // Flipped true on the open→true transition and false when it
  // closes. Used to distinguish "this is a fresh open" (reset all
  // transient UI) from "parent handed us an updated workspace row
  // mid-edit because onUpdated fired and the list refetched"
  // (sync form state only; do NOT reset activeTab, editing flags,
  // invite state, etc. or saves would kick the admin back to
  // Overview every time they toggle something).
  const wasOpenRef = useRef(false);

  useEffect(() => {
    // Reset the "first open" flag when the modal closes so the
    // next open re-enters as a fresh session. Without this, the
    // second open would be treated as a mid-edit prop update and
    // skip the transient-UI reset.
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (!workspace) return;
    {
      const freshOpen = !wasOpenRef.current;
      wasOpenRef.current = true;

      // Form-source-of-truth fields — safe to re-sync whenever the
      // workspace row changes. If the admin is editing Name and a
      // save lands, we let the saved value take over.
      setWsName(workspace.name);
      setWsColor(workspace.color || "var(--accent-green-primary)");
      setWsDescription(workspace.description || "");
      setWsDefaultRole((workspace.defaultRole as "admin" | "editor" | "viewer") || "editor");
      setRequire2fa(workspace.require2fa ?? false);
      setLinksDisabled(workspace.linksDisabled ?? false);
      setLinksRequirePassword(workspace.linksRequirePassword ?? false);
      setLinksMaxExpiryDays(workspace.linksMaxExpiryDays ?? null);
      setLinksMaxExpiryDraft(
        workspace.linksMaxExpiryDays == null ? "" : String(workspace.linksMaxExpiryDays),
      );

      // Transient UI state — only reset on a fresh open. Without
      // the `freshOpen` gate, every `onUpdated` roundtrip would
      // bounce the admin back to the Overview tab.
      if (!freshOpen) return;
      setEditingName(false);
      setEditingDescription(false);
      setTransferOpen(false);
      setTransferTarget(null);
      setInviteOpen(false);
      setInviteEmail("");
      setInviteError(null);
      setActiveTab("overview");
      setMaxExpiryError(null);
      // Fetch the admin-overview payload in parallel. Stats +
      // members are member-visible; the activity endpoint is
      // admin-only, so gate that fetch on role.
      (async () => {
        try {
          const workspaceIsAdmin = workspace.role === "admin";
          const [statsRes, membersRes, activityRes] = await Promise.all([
            fetch(`/api/workspaces/stats?workspaceId=${workspace.id}`),
            fetch(`/api/workspaces/members?workspaceId=${workspace.id}`),
            workspaceIsAdmin
              ? fetch(`/api/workspaces/activity?workspaceId=${workspace.id}`)
              : Promise.resolve(null),
          ]);
          if (statsRes.ok) {
            const s = await statsRes.json();
            setStats(s);
            // The workspace prop might be stale / partial (the
            // workspace-switcher's Workspace type doesn't include
            // policy fields today), so override the local policy
            // state with the DB truth as soon as it lands.
            setRequire2fa(Boolean(s.require2fa));
            setLinksDisabled(Boolean(s.linksDisabled));
            setLinksRequirePassword(Boolean(s.linksRequirePassword));
            setLinksMaxExpiryDays(
              s.linksMaxExpiryDays == null ? null : Number(s.linksMaxExpiryDays),
            );
            setLinksMaxExpiryDraft(
              s.linksMaxExpiryDays == null ? "" : String(s.linksMaxExpiryDays),
            );
          } else {
            setStats(null);
          }
          if (membersRes.ok) {
            const d = await membersRes.json();
            setMembers(d.members ?? []);
          } else {
            setMembers([]);
          }
          if (activityRes && activityRes.ok) {
            const d = await activityRes.json();
            // Keep everything the endpoint returns (caps at 50)
            // — the UI below scrolls inside a fixed-height
            // container, so more events don't push the tab
            // around.
            setActivity(d.events ?? []);
          } else {
            setActivity([]);
          }
        } catch {
          setStats(null);
          setMembers([]);
          setActivity([]);
        }
      })();
    }
  }, [open, workspace]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !workspace) return null;

  const updateField = async (fields: Record<string, string>) => {
    const res = await fetch("/api/workspaces/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace.id, ...fields }),
    });
    if (res.ok) {
      onUpdated?.();
      window.dispatchEvent(new Event("securewarp-workspace-updated"));
    }
  };

  const handleRename = async () => {
    if (!wsName.trim() || wsName.trim() === workspace.name) { setEditingName(false); return; }
    const res = await fetch("/api/workspaces/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace.id, name: wsName.trim() }),
    });
    setEditingName(false);
    if (res.ok) {
      onUpdated?.();
      window.dispatchEvent(new Event("securewarp-workspace-updated"));
    }
  };

  const handleColorChange = async (color: string) => {
    setWsColor(color);
    await updateField({ color });
  };

  const handleDescriptionSave = async () => {
    if (wsDescription.trim() === (workspace.description || "")) { setEditingDescription(false); return; }
    await updateField({ description: wsDescription.trim() });
    setEditingDescription(false);
  };

  const handleDefaultRoleChange = async (role: string) => {
    setWsDefaultRole(role as "admin" | "editor" | "viewer");
    await updateField({ defaultRole: role });
  };

  /**
   * Policy toggles (2FA + link disable + link require-password).
   * Updates the local state optimistically then posts the flip. On
   * API failure we roll back so the UI doesn't diverge from the DB.
   * Each toggle is independent — shipping one doesn't clobber
   * another because the /api/workspaces/update handler ignores
   * undefined keys.
   */
  const postPolicy = async (
    body: Record<string, boolean | number | null>,
    rollback: () => void,
  ) => {
    const res = await fetch("/api/workspaces/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace?.id, ...body }),
    });
    if (!res.ok) rollback();
    else {
      onUpdated?.();
      window.dispatchEvent(new Event("securewarp-workspace-updated"));
    }
  };

  const handleRequire2faToggle = async () => {
    const next = !require2fa;
    setRequire2fa(next);
    await postPolicy({ require2fa: next }, () => setRequire2fa(!next));
  };

  const handleLinksDisabledToggle = async () => {
    const next = !linksDisabled;
    setLinksDisabled(next);
    await postPolicy({ linksDisabled: next }, () => setLinksDisabled(!next));
  };

  const handleLinksRequirePasswordToggle = async () => {
    const next = !linksRequirePassword;
    setLinksRequirePassword(next);
    await postPolicy(
      { linksRequirePassword: next },
      () => setLinksRequirePassword(!next),
    );
  };

  const handleMaxExpirySave = async () => {
    setMaxExpiryError(null);
    const raw = linksMaxExpiryDraft.trim();
    let next: number | null = null;
    if (raw.length > 0) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        setMaxExpiryError("Must be a whole number between 1 and 365.");
        return;
      }
      next = n;
    }
    const prev = linksMaxExpiryDays;
    setLinksMaxExpiryDays(next);
    await postPolicy(
      { linksMaxExpiryDays: next },
      () => {
        setLinksMaxExpiryDays(prev);
        setLinksMaxExpiryDraft(prev == null ? "" : String(prev));
        setMaxExpiryError("Save failed. Reverted.");
      },
    );
  };

  const handleChangeRole = async (userId: string, role: string) => {
    // Optimistic update — rollback on failure.
    const prev = members;
    setMembers((ms) => ms.map((m) => (m.userId === userId ? { ...m, role } : m)));
    const res = await fetch("/api/workspaces/change-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace?.id, userId, role }),
    });
    if (!res.ok) setMembers(prev);
  };

  const handleRemoveMember = async (userId: string) => {
    const prev = members;
    setMembers((ms) => ms.filter((m) => m.userId !== userId));
    const res = await fetch("/api/workspaces/remove-member", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace?.id, userId }),
    });
    if (!res.ok) setMembers(prev);
    else setStats((s) => (s ? { ...s, memberCount: Math.max(0, s.memberCount - 1) } : s));
  };

  const handleInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || inviteBusy) return;
    setInviteBusy(true);
    setInviteError(null);
    try {
      const res = await fetch("/api/workspaces/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace?.id, email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteError(data?.error || "Invite failed.");
        return;
      }
      // Refresh the member list — the invite endpoint inserts a
      // workspace_members row immediately for existing accounts.
      const membersRes = await fetch(`/api/workspaces/members?workspaceId=${workspace?.id}`);
      if (membersRes.ok) {
        const d = await membersRes.json();
        setMembers(d.members ?? []);
        setStats((s) => (s ? { ...s, memberCount: d.members?.length ?? s.memberCount } : s));
      }
      setInviteEmail("");
      setInviteOpen(false);
    } finally {
      setInviteBusy(false);
    }
  };

  const handleDelete = async () => {
    setDeleteBusy(true);
    try {
      const res = await fetch("/api/workspaces/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id }),
      });
      if (res.ok) {
        setDeleteBusy(false);
        setDeleteOpen(false);
        onDeleted();
        onClose();
      } else {
        setDeleteBusy(false);
      }
    } catch {
      setDeleteBusy(false);
    }
  };

  const activeTabLabel = TABS.find((t) => t.id === activeTab)?.label ?? activeTab;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        role="dialog" aria-modal="true" aria-label="Workspace Settings"
        className="relative w-full max-w-[720px] mx-4 rounded-2xl bg-bg-l2 border border-border-primary overflow-hidden animate-fade-in flex flex-col md:flex-row"
        style={{ boxShadow: "var(--shadow-l2)", height: "min(85vh, 600px)", minHeight: 420 }}
      >
        {/* Sidebar — mirrors the main Settings modal's pattern so
            the two shells feel like the same system: workspace
            identity at the top, section tabs below. */}
        <div className="md:w-[190px] shrink-0 bg-bg-side border-b md:border-b-0 md:border-r border-border-tertiary flex md:flex-col overflow-x-auto md:overflow-x-hidden md:overflow-y-auto">
          <div className="hidden md:flex items-center gap-2.5 px-3 py-3 mx-2 mt-2 rounded-[6px]">
            <div
              className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[11px] font-bold text-white shrink-0"
              style={{ backgroundColor: wsColor }}
            >
              {workspace.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-[12px] text-text-primary font-medium truncate">{workspace.name}</p>
              <p className="text-[10px] text-text-disabled truncate">
                {ROLE_LABELS[workspace.role] ?? workspace.role}
              </p>
            </div>
          </div>
          <div className="flex-1 px-2 py-2 flex md:block gap-1 md:gap-0 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`md:w-full flex items-center gap-2.5 px-3 md:px-2 h-[32px] rounded-[6px] text-[12px] transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  activeTab === t.id
                    ? "bg-bg-overlay-tertiary text-text-primary font-medium"
                    : "text-text-secondary hover:bg-bg-overlay-tertiary"
                }`}
              >
                <HugeiconsIcon icon={t.icon} size={15} />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content — section title + X on top, scrollable body
            below. Each activeTab branch renders one of the four
            grouped sections. */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-tertiary shrink-0">
            <h3 className="text-[16px] font-semibold text-text-primary">{activeTabLabel}</h3>
            <button onClick={onClose} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer">
              <HugeiconsIcon icon={Cancel01Icon} size={16} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {activeTab === "overview" && (
          <div className="space-y-4">
            {/* Banner — workspace identity moment. Color-tinted
                background with name + description + created date
                + owner. Sits full-width across the content area
                so the tab has a "landing card" feel before the
                data tiles. */}
            <div
              className="relative rounded-[12px] overflow-hidden px-4 py-4"
              style={{
                background: `color-mix(in srgb, ${wsColor} 12%, var(--bg-overlay-tertiary))`,
                border: "1px solid var(--border-tertiary)",
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-[8px] flex items-center justify-center text-[14px] font-bold text-white shrink-0"
                  style={{ backgroundColor: wsColor }}
                >
                  {workspace.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-text-primary truncate">{workspace.name}</p>
                  <p className="text-[12px] text-text-secondary mt-0.5 line-clamp-2">
                    {workspace.description || "No description"}
                  </p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-border-tertiary flex items-center justify-between text-[11px] text-text-disabled">
                <span>
                  Created {stats?.createdAt ? formatRelative(stats.createdAt) : "—"}
                </span>
                <span>
                  Owned by {stats?.ownerDisplayName || stats?.ownerEmail || "—"}
                </span>
              </div>
            </div>

            {/* At-a-glance stats — rendered as a bordered list
                with a color dot + label + right-aligned mono
                value, matching the "Breakdown" view in Settings →
                Storage. Colors pulled from the file-type palette
                so the dots feel consistent across the app. */}
            <div>
              <p className="text-[10px] font-mono uppercase text-text-disabled tracking-wider mb-2">Breakdown</p>
              <div className="rounded-[10px] border border-border-tertiary overflow-hidden">
                {[
                  { label: "Files", value: stats ? stats.fileCount.toLocaleString() : "—", color: "rgb(100,170,220)" },
                  { label: "Members", value: stats ? stats.memberCount.toLocaleString() : "—", color: "rgb(239,90,60)" },
                  { label: "Storage", value: stats ? formatBytes(stats.totalBytes) : "—", color: "rgb(210,180,80)" },
                  { label: "Last activity", value: stats ? formatRelative(stats.lastActivityAt) : "—", color: "rgb(200,140,175)" },
                ].map((r) => (
                  <div
                    key={r.label}
                    className="flex items-center gap-3 px-3 py-3 border-b border-border-tertiary last:border-b-0"
                  >
                    <div className="w-[10px] h-[10px] rounded-[3px] shrink-0" style={{ backgroundColor: r.color }} />
                    <div className="flex-1">
                      <p className="text-[12px] text-text-primary">{r.label}</p>
                    </div>
                    <span className="text-[12px] text-text-secondary font-mono tabular-nums">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Security posture — read-only reflection of the
                four Security-tab toggles. Shows at a glance
                what's enforced on this workspace, without the
                admin needing to switch tabs to check. */}
            <div className="rounded-[10px] border border-border-tertiary overflow-hidden">
              <div className="px-3 py-2 bg-bg-overlay-tertiary border-b border-border-tertiary flex items-center gap-2">
                <HugeiconsIcon icon={SecurityLockIcon} size={13} color="var(--icon-tertiary)" />
                <span className="text-[11px] font-mono uppercase text-text-disabled tracking-wider">Security posture</span>
              </div>
              <div className="px-3 py-2 space-y-1.5">
                {[
                  { label: "Two-factor required", on: require2fa },
                  { label: "Public links disabled", on: linksDisabled },
                  { label: "Password required on links", on: linksRequirePassword },
                  {
                    label:
                      linksMaxExpiryDays != null
                        ? `Max link expiry: ${linksMaxExpiryDays} days`
                        : "No link expiry cap",
                    on: linksMaxExpiryDays != null,
                  },
                ].map((row) => (
                  <div key={row.label} className="flex items-center gap-2 text-[12px]">
                    <span
                      className="w-[6px] h-[6px] rounded-full shrink-0"
                      style={{
                        background: row.on ? "var(--text-link)" : "var(--border-secondary)",
                      }}
                    />
                    <span className={row.on ? "text-text-primary" : "text-text-disabled"}>
                      {row.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent activity feed — admin-only. Shows the last
                5 events so admins can see "what's happening here"
                without opening the dedicated activity modal. */}
            {isAdmin && (
              <div>
                <p className="text-[10px] font-mono uppercase text-text-disabled tracking-wider mb-2">Recent activity</p>
                {activity.length === 0 ? (
                  <div className="px-3 py-4 rounded-[10px] border border-border-tertiary text-[11px] text-text-disabled text-center">
                    Nothing yet. Activity will appear as members interact with this workspace.
                  </div>
                ) : (
                  /* Scroll inside the activity container so a busy
                     workspace doesn't push the rest of the tab
                     off-screen. ~5 rows tall, scrollbar-gutter
                     keeps alignment steady when the scrollbar
                     appears. */
                  <div
                    className="rounded-[10px] border border-border-tertiary overflow-y-auto overflow-x-hidden"
                    style={{ maxHeight: 220, scrollbarGutter: "stable" }}
                  >
                    {activity.map((e, i) => {
                      const actorName = e.actorDisplayName?.trim() || e.actorEmail || "Someone";
                      const actorUser = {
                        email: e.actorEmail ?? "",
                        displayName: e.actorDisplayName ?? null,
                      };
                      const actorColor = userColor(actorUser);
                      const actorInitials = userInitials(actorUser);
                      return (
                        <div
                          key={e.id}
                          className={`flex items-center gap-2.5 px-3 py-2 ${i === activity.length - 1 ? "" : "border-b border-border-tertiary"}`}
                        >
                          <div
                            className="w-6 h-6 rounded-[5px] flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                            style={{ backgroundColor: actorColor }}
                          >
                            {actorInitials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11.5px] text-text-primary truncate">
                              <span className="font-medium">{actorName}</span>{" "}
                              <span className="text-text-disabled">{activityLabel(e.type)}</span>
                            </p>
                          </div>
                          <span className="text-[10px] text-text-disabled tabular-nums shrink-0">
                            {formatRelative(e.createdAt)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {activeTab === "general" && (
          <div>
          {/* Name */}
          <div className="py-4 border-b border-border-tertiary">
            <p className="text-[11px] font-mono uppercase text-text-disabled tracking-wider mb-2">Name</p>
            {editingName && isAdmin ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  autoFocus
                  className="flex-1 px-3 py-2 rounded-[8px] bg-bg-field text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-green/25 border border-transparent focus:border-accent-green/40"
                  onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditingName(false); }}
                />
                <button onClick={handleRename} className="h-[32px] px-3 rounded-[6px] text-[11px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 cursor-pointer">Save</button>
                <button onClick={() => { setEditingName(false); setWsName(workspace.name); }} className="h-[32px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary cursor-pointer">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-text-primary font-medium">{workspace.name}</span>
                {isAdmin && (
                  <button onClick={() => setEditingName(true)} className="text-[11px] text-text-link hover:underline cursor-pointer">Edit</button>
                )}
              </div>
            )}
          </div>

          {/* Color */}
          <div className="py-4 border-b border-border-tertiary">
            <p className="text-[11px] font-mono uppercase text-text-disabled tracking-wider mb-2">Color</p>
            <div className="flex items-center gap-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => isAdmin && handleColorChange(color)}
                  disabled={!isAdmin}
                  title={COLOR_NAMES[color]}
                  className="w-7 h-7 rounded-full flex items-center justify-center transition-all cursor-pointer disabled:cursor-default"
                  style={{
                    backgroundColor: color,
                    boxShadow: wsColor === color ? `0 0 0 2px var(--bg-l3), 0 0 0 4px ${color}` : "none",
                  }}
                >
                  {wsColor === color && (
                    <HugeiconsIcon icon={Tick01Icon} size={14} color="white" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="py-4 border-b border-border-tertiary">
            <p className="text-[11px] font-mono uppercase text-text-disabled tracking-wider mb-2">Description</p>
            {editingDescription && isAdmin ? (
              <div>
                <textarea
                  value={wsDescription}
                  onChange={(e) => setWsDescription(e.target.value)}
                  maxLength={200}
                  autoFocus
                  rows={3}
                  placeholder="What is this workspace for?"
                  className="w-full px-3 py-2 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 border border-transparent focus:border-accent-green/40 resize-none"
                  onKeyDown={(e) => { if (e.key === "Escape") { setEditingDescription(false); setWsDescription(workspace.description || ""); } }}
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-text-disabled">{wsDescription.length}/200</span>
                  <div className="flex gap-2">
                    <button onClick={() => { setEditingDescription(false); setWsDescription(workspace.description || ""); }} className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary cursor-pointer">Cancel</button>
                    <button onClick={handleDescriptionSave} className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 cursor-pointer">Save</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-text-secondary">
                  {workspace.description || "No description"}
                </span>
                {isAdmin && (
                  <button onClick={() => setEditingDescription(true)} className="text-[11px] text-text-link hover:underline cursor-pointer shrink-0 ml-2">Edit</button>
                )}
              </div>
            )}
          </div>

          {/* Default member role */}
          <div className="py-4">
            <p className="text-[11px] font-mono uppercase text-text-disabled tracking-wider mb-1">Default member role</p>
            <p className="text-[11px] text-text-disabled mb-2">Role assigned to new members when invited</p>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-text-primary">{ROLE_LABELS[wsDefaultRole]}</span>
              {isAdmin && (
                <RoleDropdown
                  value={wsDefaultRole}
                  options={ROLES}
                  labels={ROLE_LABELS}
                  onChange={(v) => handleDefaultRoleChange(v)}
                />
              )}
            </div>
          </div>
          </div>
          )}

          {activeTab === "members" && (
          <div>
          {/* Members — inline list with per-row role + remove +
              invite, grouped under the Members tab. The list
              container has its own internal scroll so long member
              rosters don't push the rest of the modal around; the
              header stays in plain flow above it without a
              colored background band. */}
          <div className="py-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[11px] font-mono uppercase text-text-disabled tracking-wider">Members</p>
                <p className="text-[11px] text-text-disabled">{members.length} in this workspace</p>
              </div>
              {isAdmin && !inviteOpen && (
                <button
                  onClick={() => { setInviteOpen(true); setInviteError(null); }}
                  className="flex items-center gap-1.5 h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer"
                >
                  <HugeiconsIcon icon={UserAdd01Icon} size={12} />
                  Invite
                </button>
              )}
            </div>

            {isAdmin && inviteOpen && (
              <div className="mb-2 animate-fade-in">
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => { setInviteEmail(e.target.value); setInviteError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && !inviteBusy) handleInvite(); }}
                    placeholder="teammate@company.com"
                    autoFocus
                    disabled={inviteBusy}
                    className="flex-1 px-3 py-2 rounded-[8px] bg-bg-field text-[12px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-text-link/25 border border-transparent focus:border-text-link/40 disabled:opacity-60"
                  />
                  <button
                    onClick={handleInvite}
                    disabled={inviteBusy || !inviteEmail.trim()}
                    className="h-[32px] px-3 rounded-[6px] text-[11px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                  >
                    {inviteBusy ? "…" : "Send"}
                  </button>
                  <button
                    onClick={() => { setInviteOpen(false); setInviteEmail(""); setInviteError(null); }}
                    className="h-[32px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
                {inviteError && (
                  <p className="text-[11px] text-accent-red mt-1.5 px-1">{inviteError}</p>
                )}
              </div>
            )}

            {members.length > 0 && (
              <div
                className="rounded-[10px] border border-border-tertiary overflow-y-auto overflow-x-hidden"
                style={{ maxHeight: 320, scrollbarGutter: "stable" }}
              >
                {members.map((m, i) => {
                  const isSelf = m.email === myEmail;
                  return (
                    <div
                      key={m.userId}
                      className={`flex items-center gap-2.5 px-3 py-2 ${i === members.length - 1 ? "" : "border-b border-border-tertiary"}`}
                    >
                      <div
                        className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                        style={{ backgroundColor: userColor(m) }}
                      >
                        {userInitials(m)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-text-primary truncate">
                          {userLabel(m)}
                          {isSelf && (
                            <span className="ml-1.5 text-[10px] text-text-disabled font-normal">· you</span>
                          )}
                        </p>
                        {m.displayName?.trim() && m.email && (
                          <p className="text-[10px] text-text-disabled truncate">{m.email}</p>
                        )}
                      </div>
                      {isAdmin && !isSelf ? (
                        <RoleDropdown
                          value={m.role}
                          options={ROLES}
                          labels={ROLE_LABELS}
                          onChange={(v) => handleChangeRole(m.userId, v)}
                          onRemove={() => handleRemoveMember(m.userId)}
                        />
                      ) : (
                        <span className="text-[11px] text-text-disabled px-2 capitalize">
                          {ROLE_LABELS[m.role] ?? m.role}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          </div>
          )}

          {activeTab === "security" && (
          <div>
            {/* Each toggle is an independent round-trip. Admins
                get the interactive controls; everyone else sees
                the same values as read-only so members can tell
                what the workspace's posture is. */}
            <PolicyToggleRow
              title="Require two-factor authentication"
              description="Members without TOTP will see this workspace as locked until they enable 2FA. Enforcement in the file routes ships next."
              checked={require2fa}
              disabled={!isAdmin}
              onToggle={handleRequire2faToggle}
            />
            <PolicyToggleRow
              title="Disable public links"
              description="Block any new shareable /share/<id> links on this workspace's files. Existing links are not revoked — use the Share modal per-file to revoke those."
              checked={linksDisabled}
              disabled={!isAdmin}
              onToggle={handleLinksDisabledToggle}
            />
            <PolicyToggleRow
              title="Require password on every link"
              description="New public links must include a password. Enforced server-side — the UI alone isn't load-bearing."
              checked={linksRequirePassword}
              disabled={!isAdmin || linksDisabled}
              onToggle={handleLinksRequirePasswordToggle}
            />
            <div className="py-4">
              <p className="text-[13px] text-text-primary">Maximum link expiry</p>
              <p className="text-[11px] text-text-disabled mt-0.5 mb-2">
                Cap new links to at most N days. Leave empty for no cap. Existing links are not affected.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  value={linksMaxExpiryDraft}
                  onChange={(e) => { setLinksMaxExpiryDraft(e.target.value); setMaxExpiryError(null); }}
                  disabled={!isAdmin || linksDisabled}
                  placeholder="e.g. 30"
                  className="w-[110px] px-3 py-2 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-text-link/25 border border-transparent focus:border-text-link/40 disabled:opacity-60"
                />
                <span className="text-[12px] text-text-disabled">days</span>
                {isAdmin && (
                  <button
                    onClick={handleMaxExpirySave}
                    disabled={linksDisabled}
                    className="h-[32px] px-3 rounded-[6px] text-[11px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 cursor-pointer disabled:opacity-50"
                  >
                    Save
                  </button>
                )}
                {linksMaxExpiryDays != null && (
                  <span className="text-[11px] text-text-disabled">Current: {linksMaxExpiryDays} days</span>
                )}
              </div>
              {maxExpiryError && (
                <p className="text-[11px] text-accent-red mt-1.5">{maxExpiryError}</p>
              )}
            </div>
          </div>
          )}

          {activeTab === "danger" && (
          <div>
          {/* Transfer ownership — admin only, API enforces owner check */}
          {isAdmin && (
            <div className="py-4 border-b border-border-tertiary">
              {!transferOpen ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-mono uppercase text-text-disabled tracking-wider mb-0.5">Transfer ownership</p>
                    <p className="text-[11px] text-text-disabled">Transfer to another admin</p>
                  </div>
                  <button
                    onClick={async () => {
                      setTransferOpen(true);
                      const res = await fetch(`/api/workspaces/members?workspaceId=${workspace.id}`);
                      const d = await res.json();
                      if (d.members) {
                        let myEmail = "";
                        try { myEmail = JSON.parse(sessionStorage.getItem("securewarp_keys") || "{}").email || ""; } catch { /* */ }
                        setAdminMembers(
                          d.members
                            .filter((m: { role: string; email: string }) => m.role === "admin" && m.email !== myEmail)
                            .map((m: { userId: string; email: string; displayName?: string | null }) => ({ userId: m.userId, email: m.email, displayName: m.displayName ?? null }))
                        );
                      }
                    }}
                    className="text-[11px] text-text-link hover:underline cursor-pointer shrink-0"
                  >
                    Transfer
                  </button>
                </div>
              ) : adminMembers.length === 0 ? (
                <div>
                  <p className="text-[12px] text-text-tertiary mb-2">No other admin members. Promote a member to admin first.</p>
                  <button
                    onClick={() => setTransferOpen(false)}
                    className="text-[11px] text-text-link hover:underline cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div>
                  <div className="rounded-[10px] border border-border-tertiary overflow-hidden mb-2">
                    {adminMembers.map((m) => (
                      <button
                        key={m.userId}
                        onClick={() => setTransferTarget(m)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 border-b border-border-tertiary last:border-b-0 hover:bg-bg-cell-hover transition-colors cursor-pointer ${
                          transferTarget?.userId === m.userId ? "bg-bg-cell-hover" : ""
                        }`}
                      >
                        <div
                          className="w-6 h-6 rounded-[5px] flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                          style={{ backgroundColor: userColor(m) }}
                        >
                          {userInitials(m)}
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-[12px] text-text-primary truncate">{userLabel(m)}</p>
                          {m.displayName?.trim() && m.email && (
                            <p className="text-[10px] text-text-disabled truncate">{m.email}</p>
                          )}
                        </div>
                        {transferTarget?.userId === m.userId && (
                          <HugeiconsIcon icon={Tick01Icon} size={12} color="var(--accent-green-primary)" className="ml-auto shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setTransferOpen(false); setTransferTarget(null); }}
                      className="h-[30px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        if (!transferTarget || transferBusy) return;
                        setTransferBusy(true);
                        const res = await fetch("/api/workspaces/transfer", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ workspaceId: workspace.id, newOwnerId: transferTarget.userId }),
                        });
                        setTransferBusy(false);
                        if (res.ok) {
                          setTransferOpen(false);
                          setTransferTarget(null);
                          onUpdated?.();
                          window.dispatchEvent(new Event("securewarp-workspace-updated"));
                        }
                      }}
                      disabled={!transferTarget || transferBusy}
                      className="h-[30px] px-3 rounded-[6px] text-[11px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {transferBusy ? "Transferring..." : "Confirm transfer"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Delete / Leave action */}
          <div className="py-4">
            {isAdmin ? (
              <button
                onClick={() => setDeleteOpen(true)}
                className="flex items-center gap-2 h-[34px] px-4 rounded-[8px] text-[12px] font-medium text-accent-red border border-accent-red/20 hover:bg-accent-red/10 transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={Delete02Icon} size={14} />
                Delete workspace
              </button>
            ) : (
              <button
                onClick={async () => {
                  await fetch("/api/workspaces/leave", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ workspaceId: workspace.id }),
                  });
                  onDeleted();
                  onClose();
                }}
                className="flex items-center gap-2 h-[34px] px-4 rounded-[8px] text-[12px] font-medium text-accent-red border border-accent-red/20 hover:bg-accent-red/10 transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={Logout01Icon} size={14} />
                Leave workspace
              </button>
            )}
          </div>
          </div>
          )}
          </div>
        </div>

        <ConfirmDialog
          open={deleteOpen}
          title="Delete workspace?"
          description="This will permanently delete the workspace and all files inside it. All members will lose access. This cannot be undone."
          confirmLabel="Delete workspace"
          destructive
          busy={deleteBusy}
          busyLabel="Deleting..."
          onConfirm={handleDelete}
          onCancel={() => !deleteBusy && setDeleteOpen(false)}
        />
      </div>
    </div>,
    document.body
  );
}

/**
 * Security-tab row: label + description on the left, toggle switch
 * on the right. Uses the same 34x20 pill shape as the main Settings
 * modal's Toggle component. Visually gated (`disabled`) for
 * non-admins so members can read the workspace posture without
 * accidentally tripping a change handler.
 */
function PolicyToggleRow({
  title,
  description,
  checked,
  disabled,
  onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-border-tertiary">
      <div className="min-w-0">
        <p className="text-[13px] text-text-primary">{title}</p>
        <p className="text-[11px] text-text-disabled mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => { if (!disabled) onToggle(); }}
        aria-pressed={checked}
        disabled={disabled}
        className={`shrink-0 w-[36px] h-[20px] rounded-full transition-colors cursor-pointer ${
          checked ? "bg-text-link" : "bg-bg-field"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <div
          className={`w-[16px] h-[16px] rounded-full bg-white transition-transform mx-[2px] ${checked ? "translate-x-[16px]" : ""}`}
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}
        />
      </button>
    </div>
  );
}
