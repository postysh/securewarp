"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Logout01Icon from "@hugeicons/core-free-icons/Logout01Icon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import { ConfirmDialog } from "./confirm-dialog";
import { RoleDropdown } from "./role-dropdown";
import { colorForEmail } from "./facepile";

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
  "var(--accent-green-primary)": "Green",
  "var(--accent-blue-primary)": "Blue",
  "var(--accent-pink-primary)": "Pink",
  "var(--accent-orange-primary)": "Orange",
  "var(--accent-yellow-primary)": "Yellow",
  "var(--accent-red-primary)": "Red",
};

const ROLES = ["admin", "editor", "viewer"] as const;
const ROLE_LABELS: Record<string, string> = { admin: "Admin", editor: "Editor", viewer: "Viewer" };

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
  const [adminMembers, setAdminMembers] = useState<{ userId: string; email: string }[]>([]);
  const isAdmin = workspace?.role === "admin";

  useEffect(() => {
    if (open && workspace) {
      setWsName(workspace.name);
      setEditingName(false);
      setWsColor(workspace.color || "var(--accent-green-primary)");
      setWsDescription(workspace.description || "");
      setEditingDescription(false);
      setWsDefaultRole((workspace.defaultRole as "admin" | "editor" | "viewer") || "editor");
      setTransferOpen(false);
      setTransferTarget(null);
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

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        role="dialog" aria-modal="true" aria-label="Workspace Settings"
        className="relative w-full h-full md:h-auto max-w-none md:max-w-[420px] mx-0 md:mx-4 rounded-none md:rounded-2xl bg-bg-l3 border-0 md:border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <span className="text-[14px] font-semibold text-text-primary">Workspace Settings</span>
          <button onClick={onClose} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer">
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: "min(70vh, 480px)" }}>
          {/* Name */}
          <div className="px-5 py-4 border-b border-border-tertiary">
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
          <div className="px-5 py-4 border-b border-border-tertiary">
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
          <div className="px-5 py-4 border-b border-border-tertiary">
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
          <div className="px-5 py-4 border-b border-border-tertiary">
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

          {/* Transfer ownership — admin only, API enforces owner check */}
          {isAdmin && (
            <div className="px-5 py-4 border-b border-border-tertiary">
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
                            .map((m: { userId: string; email: string }) => ({ userId: m.userId, email: m.email }))
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
                          style={{ backgroundColor: colorForEmail(m.email) }}
                        >
                          {m.email.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-[12px] text-text-primary truncate">{m.email}</span>
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

          {/* Danger zone */}
          <div className="px-5 py-4">
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
