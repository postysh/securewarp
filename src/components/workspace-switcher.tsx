"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import UnfoldMoreIcon from "@hugeicons/core-free-icons/UnfoldMoreIcon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import Setting07Icon from "@hugeicons/core-free-icons/Setting07Icon";
import { Tooltip } from "./tooltip";
import { useFilesContext } from "@/hooks/use-files";
import { WorkspaceSettings } from "./workspace-settings";

interface Workspace {
  id: string;
  name: string;
  rootFolderId: string;
  ownerId: string;
  role: string;
}

const COLORS = [
  "var(--accent-green-primary)",
  "var(--accent-blue-primary)",
  "var(--accent-pink-primary)",
  "var(--accent-orange-primary)",
  "var(--accent-yellow-primary)",
  "var(--accent-red-primary)",
];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const fileOps = useFilesContext();
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = sessionStorage.getItem("securewarp_active_workspace");
      if (saved) return JSON.parse(saved).id;
    } catch { /* */ }
    return null;
  });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    fetch("/api/workspaces").then((r) => r.json()).then((d) => {
      if (d.workspaces) {
        setWorkspaces(d.workspaces);
        // Validate the saved workspace still exists
        try {
          const savedStr = sessionStorage.getItem("securewarp_active_workspace");
          if (savedStr) {
            const saved = JSON.parse(savedStr);
            const ws = d.workspaces.find((w: Workspace) => w.id === saved.id);
            if (!ws) sessionStorage.removeItem("securewarp_active_workspace");
          }
        } catch {
          sessionStorage.removeItem("securewarp_active_workspace");
        }
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    if (collapsed) {
      setPos({ top: rect.top, left: rect.right + 8 });
    } else {
      setPos({ top: rect.bottom + 6, left: rect.left });
    }
  }, [collapsed]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleToggle = () => {
    if (!open) updatePos();
    setOpen(!open);
  };

  const switchToPersonal = () => {
    setActiveId(null);
    sessionStorage.removeItem("securewarp_active_workspace");
    fileOps.leaveWorkspace();
    setOpen(false);
  };

  const switchToWorkspace = (ws: Workspace) => {
    setActiveId(ws.id);
    sessionStorage.setItem("securewarp_active_workspace", JSON.stringify({ id: ws.id, rootFolderId: ws.rootFolderId, name: ws.name }));
    fileOps.navigateToWorkspace(ws.id, ws.rootFolderId, ws.name);
    setOpen(false);
  };

  const refreshWorkspaces = async () => {
    const res = await fetch("/api/workspaces");
    const d = await res.json();
    if (d.workspaces) setWorkspaces(d.workspaces);
  };

  const activeName = activeId
    ? workspaces.find((w) => w.id === activeId)?.name ?? "Workspace"
    : "Personal";
  const activeColor = activeId
    ? colorForName(workspaces.find((w) => w.id === activeId)?.name ?? "")
    : "var(--accent-green-primary)";
  const activeInitial = activeName.charAt(0).toUpperCase();

  const dropdown = open && createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] w-[240px] rounded-[10px] bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in"
      style={{ top: pos.top, left: pos.left, boxShadow: "var(--shadow-l2)" }}
    >
      {/* Workspace list — scrollable */}
      <div className="max-h-[280px] overflow-y-auto">
        <div className="py-1.5">
          {/* Personal */}
          <button
            onClick={switchToPersonal}
            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-bg-cell-hover transition-colors cursor-pointer"
          >
            <div className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: "var(--accent-green-primary)" }}>
              P
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-[12px] text-text-primary truncate">Personal</p>
              <p className="text-[10px] text-text-disabled">My Drive</p>
            </div>
            {activeId === null && <HugeiconsIcon icon={Tick01Icon} size={14} color="var(--accent-green-primary)" />}
          </button>
          {/* Workspaces */}
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => switchToWorkspace(ws)}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-bg-cell-hover transition-colors cursor-pointer"
            >
              <div className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: colorForName(ws.name) }}>
                {ws.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[12px] text-text-primary truncate">{ws.name}</p>
                <p className="text-[10px] text-text-disabled">{ws.role === "owner" ? "Created by you" : "Shared with you"}</p>
              </div>
              {ws.id === activeId && <HugeiconsIcon icon={Tick01Icon} size={14} color="var(--accent-green-primary)" />}
            </button>
          ))}
        </div>
      </div>
      {/* Actions */}
      <div className="border-t border-border-tertiary py-1.5">
        {activeId && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => { setShowSettings(true); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 h-[36px] text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={Setting07Icon} size={14} color="var(--icon-tertiary)" />
            Workspace settings
          </button>
        )}
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => { setShowCreateModal(true); setOpen(false); }}
          className="w-full flex items-center gap-2.5 px-3 h-[36px] text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
        >
          <HugeiconsIcon icon={Add01Icon} size={14} color="var(--icon-tertiary)" />
          Create workspace
        </button>
      </div>
    </div>,
    document.body
  );

  const createModal = showCreateModal && createPortal(
    <CreateWorkspaceModal
      onClose={() => setShowCreateModal(false)}
      onCreate={async (ws) => {
        await refreshWorkspaces();
        switchToWorkspace(ws);
        setShowCreateModal(false);
      }}
    />,
    document.body
  );

  if (collapsed) {
    return (
      <>
        <Tooltip label={activeName}>
          <button
            ref={btnRef}
            onClick={handleToggle}
            className="w-8 h-8 rounded-[6px] flex items-center justify-center hover:opacity-90 transition-opacity cursor-pointer"
            style={{ backgroundColor: activeColor }}
          >
            <span className="text-[11px] font-bold text-text-inverse">{activeInitial}</span>
          </button>
        </Tooltip>
        {dropdown}
        {createModal}
        <WorkspaceSettings
          open={showSettings}
          onClose={() => setShowSettings(false)}
          workspace={activeId ? workspaces.find((w) => w.id === activeId) ?? null : null}
          onDeleted={() => { setActiveId(null); fileOps.leaveWorkspace(); refreshWorkspaces(); }}
        />
      </>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="w-full flex items-center gap-3 h-[36px] px-2.5 rounded-[6px] hover:bg-cta-nav-hover transition-colors cursor-pointer"
      >
        <div className="w-7 h-7 rounded-[6px] flex items-center justify-center shrink-0" style={{ backgroundColor: activeColor }}>
          <span className="text-[11px] font-bold text-text-inverse">{activeInitial}</span>
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[13px] text-text-primary font-semibold truncate block whitespace-nowrap">{activeName}</span>
        </div>
        <HugeiconsIcon icon={UnfoldMoreIcon} size={14} color="var(--icon-tertiary)" />
      </button>
      {dropdown}
      {createModal}
      <WorkspaceSettings
        open={showSettings}
        onClose={() => setShowSettings(false)}
        workspace={activeId ? workspaces.find((w) => w.id === activeId) ?? null : null}
        onDeleted={() => { setActiveId(null); fileOps.leaveWorkspace(); refreshWorkspaces(); }}
      />
    </>
  );
}

function CreateWorkspaceModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (ws: Workspace) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, busy]);

  const handleCreate = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const folderPayload = await buildWorkspaceFolder(name.trim());
      const folderRes = await fetch("/api/files/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(folderPayload),
      });
      const folderData = await folderRes.json();
      if (!folderRes.ok) throw new Error(folderData.error || "Failed to create folder");

      const wsRes = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), rootFolderId: folderData.folderId }),
      });
      const wsData = await wsRes.json();
      if (!wsRes.ok) throw new Error(wsData.error || "Failed to create workspace");

      onCreate({
        id: wsData.workspaceId,
        name: name.trim(),
        rootFolderId: folderData.folderId,
        ownerId: "",
        role: "owner",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={() => !busy && onClose()} />
      <div
        className="relative w-full h-full md:h-auto max-w-none md:max-w-[420px] mx-0 md:mx-4 rounded-none md:rounded-2xl bg-bg-l3 border-0 md:border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <span className="text-[14px] font-semibold text-text-primary">Create workspace</span>
          {!busy && (
            <button onClick={onClose} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); handleCreate(); }} className="px-5 py-5">
          <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">
            Workspace name
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Corp"
            disabled={busy}
            className="w-full px-3.5 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 border border-transparent focus:border-accent-green/40 disabled:opacity-50"
          />
          {error && (
            <p className="mt-2 text-[11px] text-accent-red">{error}</p>
          )}
          <p className="mt-3 text-[11px] text-text-disabled leading-relaxed">
            A workspace is a shared space. All files inside are accessible to every member you invite.
          </p>
          <div className="flex items-center justify-end gap-2 mt-5 flex-wrap">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] shrink-0 whitespace-nowrap"
            >
              {busy ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Build the encrypted folder payload for the workspace root.
 * Uses the user's keys from sessionStorage.
 */
async function buildWorkspaceFolder(name: string) {
  const { generateSessionKey, encryptMetadata, generateHierarchicalKeypair, wrapSessionKeyToFile, wrapPrivateHierarchicalKeyForUser } = await import("@/lib/crypto/file-crypto");

  const keysStr = sessionStorage.getItem("securewarp_keys");
  if (!keysStr) throw new Error("Not signed in");
  const keys = JSON.parse(keysStr) as { encryptionPublicKey: string; encryptionPrivateKey: string };

  const sessionKey = generateSessionKey();
  const hier = generateHierarchicalKeypair();
  const encryptedMetadata = encryptMetadata({ name, type: "folder", size: 0 }, sessionKey);
  const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(sessionKey, hier.publicKey, keys.encryptionPrivateKey);
  const encryptedPrivateHierarchicalKey = wrapPrivateHierarchicalKeyForUser(hier.privateKey, keys.encryptionPublicKey, keys.encryptionPrivateKey);

  sessionKey.fill(0);

  return {
    encryptedMetadata: JSON.stringify(encryptedMetadata),
    parentId: null,
    publicHierarchicalKey: hier.publicKey,
    encryptedSessionKeyByFile,
    sessionKeyNonce,
    encryptedPrivateHierarchicalKey,
    wrappedByPublicKey: keys.encryptionPublicKey,
  };
}
