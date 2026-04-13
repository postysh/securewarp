"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Logout01Icon from "@hugeicons/core-free-icons/Logout01Icon";
import { useFilesContext } from "@/hooks/use-files";
import { ConfirmDialog } from "./confirm-dialog";

interface WorkspaceSettingsProps {
  open: boolean;
  onClose: () => void;
  workspace: { id: string; rootFolderId: string; name: string; role: string } | null;
  onDeleted: () => void;
}

export function WorkspaceSettings({ open, onClose, workspace, onDeleted }: WorkspaceSettingsProps) {
  const fileOps = useFilesContext();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [wsName, setWsName] = useState("");
  const [editingName, setEditingName] = useState(false);

  const isAdmin = workspace?.role === "admin";

  useEffect(() => {
    if (open && workspace) {
      setWsName(workspace.name);
      setEditingName(false);
    }
  }, [open, workspace]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !workspace) return null;

  const handleRename = async () => {
    if (!wsName.trim() || wsName.trim() === workspace.name) { setEditingName(false); return; }
    await fetch("/api/workspaces/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace.id, name: wsName.trim() }),
    });
    setEditingName(false);
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

        <div className="overflow-y-auto" style={{ maxHeight: "min(70vh, 400px)" }}>
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
