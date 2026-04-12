"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import UnfoldMoreIcon from "@hugeicons/core-free-icons/UnfoldMoreIcon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import Add01Icon from "@hugeicons/core-free-icons/Add01Icon";
import { Tooltip } from "./tooltip";
import { useFilesContext } from "@/hooks/use-files";

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
  const [activeId, setActiveId] = useState<string | null>(null); // null = personal
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    fetch("/api/workspaces").then((r) => r.json()).then((d) => {
      if (d.workspaces) setWorkspaces(d.workspaces);
    }).catch(() => {});
  }, []);

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
    fileOps.leaveWorkspace();
    setOpen(false);
  };

  const switchToWorkspace = (ws: Workspace) => {
    setActiveId(ws.id);
    fileOps.navigateToWorkspace(ws.id, ws.rootFolderId, ws.name);
    setOpen(false);
  };

  const createWorkspace = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      // Create the root folder first via the existing folder API
      const folderRes = await fetch("/api/files/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await buildWorkspaceFolder(newName.trim())),
      });
      const folderData = await folderRes.json();
      if (!folderRes.ok) throw new Error(folderData.error);

      // Create the workspace pointing to this folder
      const wsRes = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), rootFolderId: folderData.folderId }),
      });
      const wsData = await wsRes.json();
      if (!wsRes.ok) throw new Error(wsData.error);

      // Refresh workspace list
      const listRes = await fetch("/api/workspaces");
      const listData = await listRes.json();
      if (listData.workspaces) setWorkspaces(listData.workspaces);

      setNewName("");
      setOpen(false);
    } catch {
      // silent
    } finally {
      setCreating(false);
    }
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
      {/* Create new — always at top */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New workspace..."
            className="flex-1 px-2 py-1.5 rounded-[6px] bg-bg-field text-[11px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-1 focus:ring-accent-green/30"
            onKeyDown={(e) => { if (e.key === "Enter") createWorkspace(); }}
          />
          <button
            onClick={createWorkspace}
            disabled={creating || !newName.trim()}
            className="h-[28px] px-2.5 rounded-[6px] text-[11px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 shrink-0"
          >
            {creating ? "..." : <HugeiconsIcon icon={Add01Icon} size={14} />}
          </button>
        </div>
      </div>

      {/* Workspace list — scrollable */}
      <div className="max-h-[240px] overflow-y-auto border-t border-border-tertiary">
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
                <p className="text-[10px] text-text-disabled">{ws.role}</p>
              </div>
              {ws.id === activeId && <HugeiconsIcon icon={Tick01Icon} size={14} color="var(--accent-green-primary)" />}
            </button>
          ))}
        </div>
      </div>
    </div>,
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
    </>
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
