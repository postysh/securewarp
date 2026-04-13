"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Logout01Icon from "@hugeicons/core-free-icons/Logout01Icon";
import { useFilesContext } from "@/hooks/use-files";
import { ConfirmDialog } from "./confirm-dialog";
import {
  unwrapPrivateHierarchicalKey,
  wrapPrivateHierarchicalKeyForUser,
} from "@/lib/crypto/file-crypto";

interface WorkspaceSettingsProps {
  open: boolean;
  onClose: () => void;
  workspace: { id: string; rootFolderId: string; name: string; role: string } | null;
  onDeleted: () => void;
}

interface Member {
  userId: string;
  email: string;
  role: string;
}

export function WorkspaceSettings({ open, onClose, workspace, onDeleted }: WorkspaceSettingsProps) {
  const fileOps = useFilesContext();
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [wsName, setWsName] = useState("");
  const [editingName, setEditingName] = useState(false);

  const isAdmin = workspace?.role === "admin";

  useEffect(() => {
    if (!open || !workspace) return;
    setWsName(workspace.name);
    setInviteEmail("");
    setInviteError(null);
    setInviteSuccess(null);
    setEditingName(false);
    // Fetch members
    fetch(`/api/workspaces/members?workspaceId=${workspace.id}`)
      .then((r) => r.json())
      .then((d) => { if (d.members) setMembers(d.members); })
      .catch(() => {});
  }, [open, workspace]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !workspace) return null;

  const handleInvite = async () => {
    if (!inviteEmail.trim() || inviteBusy) return;
    setInviteBusy(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      // Get recipient's public key
      const lookupRes = await fetch("/api/users/lookup?" + new URLSearchParams({ email: inviteEmail.trim() }));
      const lookupData = await lookupRes.json();
      if (!lookupRes.ok || !lookupData.publicEncryptionKey) {
        setInviteError(lookupData.error || "User not found");
        setInviteBusy(false);
        return;
      }

      // Wrap the workspace root folder's priv hier key for the recipient
      const keysStr = sessionStorage.getItem("securewarp_keys");
      if (!keysStr) { setInviteError("Not signed in"); setInviteBusy(false); return; }
      const keys = JSON.parse(keysStr) as { encryptionPublicKey: string; encryptionPrivateKey: string };

      // Get the root folder's encrypted priv hier key from chunk-download
      const dlRes = await fetch(`/api/files/chunk-download?fileId=${workspace.rootFolderId}`);
      const dlData = await dlRes.json();
      if (!dlRes.ok) { setInviteError("Failed to load workspace keys"); setInviteBusy(false); return; }

      const privHier = unwrapPrivateHierarchicalKey(
        dlData.encryptedPrivateHierarchicalKey,
        dlData.wrappedByPublicKey,
        keys.encryptionPrivateKey
      );
      const wrappedForRecipient = wrapPrivateHierarchicalKeyForUser(
        privHier,
        lookupData.publicEncryptionKey,
        keys.encryptionPrivateKey
      );

      const res = await fetch("/api/workspaces/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          email: inviteEmail.trim(),
          role: inviteRole,
          encryptedPrivateHierarchicalKey: wrappedForRecipient,
          wrappedByPublicKey: keys.encryptionPublicKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setInviteError(data.error || "Invite failed"); setInviteBusy(false); return; }

      setInviteSuccess(`Invited ${inviteEmail.trim()}`);
      setInviteEmail("");
      // Refresh members
      const memRes = await fetch(`/api/workspaces/members?workspaceId=${workspace.id}`);
      const memData = await memRes.json();
      if (memData.members) setMembers(memData.members);
    } catch {
      setInviteError("Invite failed");
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

  const handleRename = async () => {
    if (!wsName.trim() || wsName.trim() === workspace.name) { setEditingName(false); return; }
    await fetch("/api/workspaces/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace.id, name: wsName.trim() }),
    });
    setEditingName(false);
  };

  const handleRemoveMember = async (userId: string) => {
    await fetch("/api/workspaces/remove-member", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace.id, userId }),
    });
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        className="relative w-full h-full md:h-auto max-w-none md:max-w-[480px] mx-0 md:mx-4 rounded-none md:rounded-2xl bg-bg-l3 border-0 md:border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <span className="text-[14px] font-semibold text-text-primary">Workspace Settings</span>
          <button onClick={onClose} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer">
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: "min(70vh, 500px)" }}>
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

          {/* Invite */}
          {isAdmin && (
            <div className="px-5 py-4 border-b border-border-tertiary">
              <p className="text-[11px] font-mono uppercase text-text-disabled tracking-wider mb-2">Invite Members</p>
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => { setInviteEmail(e.target.value); setInviteError(null); setInviteSuccess(null); }}
                  placeholder="Email address"
                  disabled={inviteBusy}
                  className="flex-1 px-3 py-2 rounded-[8px] bg-bg-field text-[12px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 border border-transparent focus:border-accent-green/40 disabled:opacity-50"
                  onKeyDown={(e) => { if (e.key === "Enter") handleInvite(); }}
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "editor" | "viewer")}
                  disabled={inviteBusy}
                  className="h-[34px] px-2 rounded-[8px] bg-bg-field text-[11px] text-text-secondary border border-transparent focus:outline-none focus:ring-2 focus:ring-accent-green/25 cursor-pointer disabled:opacity-50"
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  onClick={handleInvite}
                  disabled={inviteBusy || !inviteEmail.trim()}
                  className="h-[34px] px-3 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 cursor-pointer disabled:opacity-40 flex items-center gap-1.5 shrink-0"
                >
                  <HugeiconsIcon icon={UserAdd01Icon} size={14} />
                  {inviteBusy ? "..." : "Invite"}
                </button>
              </div>
              {inviteError && <p className="mt-2 text-[11px] text-accent-red">{inviteError}</p>}
              {inviteSuccess && <p className="mt-2 text-[11px] text-accent-green">{inviteSuccess}</p>}
            </div>
          )}

          {/* Members */}
          <div className="px-5 py-4 border-b border-border-tertiary">
            <p className="text-[11px] font-mono uppercase text-text-disabled tracking-wider mb-2">
              Members ({members.length})
            </p>
            <div className="space-y-1">
              {members.map((m) => (
                <div key={m.userId} className="flex items-center gap-3 py-2">
                  <div className="w-7 h-7 rounded-full bg-bg-overlay-tertiary flex items-center justify-center text-[10px] font-bold text-text-secondary shrink-0">
                    {m.email.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-text-primary truncate">{m.email}</p>
                  </div>
                  {isAdmin && m.role !== "admin" ? (
                    <select
                      value={m.role}
                      onChange={async (e) => {
                        const newRole = e.target.value;
                        await fetch("/api/workspaces/change-role", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ workspaceId: workspace?.id, userId: m.userId, role: newRole }),
                        });
                        setMembers((prev) => prev.map((x) => x.userId === m.userId ? { ...x, role: newRole } : x));
                      }}
                      className="h-[26px] px-1.5 rounded-[6px] bg-bg-field text-[10px] text-text-secondary border-none focus:outline-none cursor-pointer"
                    >
                      <option value="admin">Admin</option>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <span className="text-[10px] text-text-disabled capitalize">{m.role}</span>
                  )}
                  {isAdmin && m.role !== "admin" && (
                    <button
                      onClick={() => handleRemoveMember(m.userId)}
                      className="text-[10px] text-accent-red hover:underline cursor-pointer shrink-0"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

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
