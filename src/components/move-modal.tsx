"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Move01Icon from "@hugeicons/core-free-icons/Move01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import type { DecryptedFile } from "@/hooks/use-files";
import { useFilesContext } from "@/hooks/use-files";
import {
  unwrapPrivateHierarchicalKey,
  unwrapSessionKeyFromFile,
  decryptMetadata,
} from "@/lib/crypto/file-crypto";

interface MoveModalProps {
  file: DecryptedFile | null;
  onClose: () => void;
}

interface FolderEntry {
  id: string;
  name: string;
  publicHierarchicalKey: string;
}

interface PathEntry {
  id: string | null;
  name: string;
  publicHierarchicalKey: string | null;
}

export function MoveModal({ file, onClose }: MoveModalProps) {
  const fileOps = useFilesContext();
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<PathEntry[]>([
    { id: null, name: "My Drive", publicHierarchicalKey: null },
  ]);

  const current = path[path.length - 1];

  const fetchFolders = useCallback(
    async (parentId: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const url = parentId
          ? `/api/files/list?parentId=${parentId}`
          : "/api/files/list";
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to load");
          setFolders([]);
          return;
        }

        const keysStr = sessionStorage.getItem("securewarp_keys");
        if (!keysStr) { setError("Not signed in"); return; }
        const { encryptionPrivateKey } = JSON.parse(keysStr) as { encryptionPrivateKey: string };

        const result: FolderEntry[] = [];
        for (const f of data.files) {
          if (!f.is_folder) continue;
          if (file && f.id === file.id) continue;
          const encPrivHier = f.encrypted_private_hierarchical_key || "";
          const wrappedBy = f.wrapped_by_public_key || "";
          const ownerPub = f.owner_public_key || "";
          if (!encPrivHier) continue;
          try {
            const privHier = unwrapPrivateHierarchicalKey(encPrivHier, wrappedBy, encryptionPrivateKey);
            const sk = unwrapSessionKeyFromFile(f.encrypted_session_key_by_file, f.session_key_nonce, ownerPub, privHier);
            const encMeta = typeof f.encrypted_metadata === "string" ? JSON.parse(f.encrypted_metadata) : f.encrypted_metadata;
            const meta = decryptMetadata(encMeta, sk);
            sk.fill(0);
            result.push({ id: f.id, name: meta.name, publicHierarchicalKey: f.public_hierarchical_key });
          } catch { /* skip unreadable */ }
        }
        setFolders(result);
      } catch {
        setError("Failed to load folders");
        setFolders([]);
      } finally {
        setLoading(false);
      }
    },
    [file]
  );

  useEffect(() => {
    if (!file) return;
    setError(null);
    setBusy(false);
    if (fileOps.activeWorkspace) {
      // In workspace context, start at the workspace root
      // Fetch the root folder's public hier key for move wrapping
      fetch(`/api/files/chunk-download?fileId=${fileOps.activeWorkspace.rootFolderId}`)
        .then((r) => r.json())
        .then((d) => {
          setPath([{
            id: fileOps.activeWorkspace!.rootFolderId,
            name: fileOps.activeWorkspace!.name,
            publicHierarchicalKey: d.publicHierarchicalKey || null,
          }]);
          fetchFolders(fileOps.activeWorkspace!.rootFolderId);
        })
        .catch(() => {
          setPath([{ id: fileOps.activeWorkspace!.rootFolderId, name: fileOps.activeWorkspace!.name, publicHierarchicalKey: null }]);
          fetchFolders(fileOps.activeWorkspace!.rootFolderId);
        });
    } else {
      setPath([{ id: null, name: "My Drive", publicHierarchicalKey: null }]);
      fetchFolders(null);
    }
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!file) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [file, onClose, busy]);

  if (!file) return null;

  const navigateInto = (folder: FolderEntry) => {
    setPath((p) => [...p, { id: folder.id, name: folder.name, publicHierarchicalKey: folder.publicHierarchicalKey }]);
    fetchFolders(folder.id);
  };

  const navigateUp = () => {
    if (path.length <= 1) return;
    const newPath = path.slice(0, -1);
    setPath(newPath);
    fetchFolders(newPath[newPath.length - 1].id);
  };

  const handleMove = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const result = await fileOps.moveFile(file, current.id, current.publicHierarchicalKey);
    setBusy(false);
    if (result.ok) {
      onClose();
    } else {
      setError(result.error);
    }
  };

  const isCurrentParent = current.id === file.parentId;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={() => !busy && onClose()} />
      <div role="dialog" aria-modal="true" aria-label="Move to" className="relative w-full h-full md:h-auto max-w-none md:max-w-[440px] mx-0 md:mx-4 rounded-none md:rounded-2xl bg-bg-l3 border-0 md:border border-border-primary overflow-hidden animate-fade-in" style={{ boxShadow: "var(--shadow-l2)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center shrink-0">
              <HugeiconsIcon icon={Move01Icon} size={18} color="var(--accent-blue-primary)" />
            </div>
            <span className="text-[14px] font-semibold text-text-primary truncate">
              Move &ldquo;{file.name}&rdquo;
            </span>
          </div>
          {!busy && (
            <button onClick={onClose} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer shrink-0">
              <HugeiconsIcon icon={Cancel01Icon} size={16} />
            </button>
          )}
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 px-5 pt-4 text-[12px] text-text-tertiary overflow-x-auto">
          {path.map((seg, i) => (
            <span key={seg.id ?? "root"} className="flex items-center gap-1 shrink-0">
              {i > 0 && <span className="text-text-disabled">/</span>}
              <button
                onClick={() => {
                  if (i === path.length - 1) return;
                  const newPath = path.slice(0, i + 1);
                  setPath(newPath);
                  fetchFolders(newPath[newPath.length - 1].id);
                }}
                className={`hover:text-text-secondary transition-colors cursor-pointer ${i === path.length - 1 ? "text-text-primary font-medium" : ""}`}
              >
                {seg.name}
              </button>
            </span>
          ))}
        </div>

        {/* Folder list */}
        <div className="px-5 py-3 max-h-[280px] min-h-[140px] overflow-y-auto">
          {path.length > 1 && (
            <button onClick={navigateUp} className="flex items-center gap-2.5 w-full px-3 h-[36px] rounded-[8px] text-[12px] text-text-tertiary hover:bg-bg-cell-hover transition-colors cursor-pointer mb-1">
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} /> Back
            </button>
          )}
          {loading ? (
            <div className="flex items-center justify-center h-[100px]">
              <span className="text-[12px] text-text-disabled">Loading…</span>
            </div>
          ) : folders.length === 0 ? (
            <div className="flex items-center justify-center h-[100px]">
              <span className="text-[12px] text-text-disabled">No folders here</span>
            </div>
          ) : (
            folders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => navigateInto(folder)}
                className="flex items-center gap-2.5 w-full px-3 h-[36px] rounded-[8px] text-[13px] text-text-primary hover:bg-bg-cell-hover transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={Folder01Icon} size={16} color="var(--accent-blue-primary)" />
                <span className="truncate">{folder.name}</span>
              </button>
            ))
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mb-3 p-2.5 rounded-lg bg-accent-red/10 border border-accent-red/20 text-[12px] text-accent-red">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-5 pb-5 flex-wrap">
          <button onClick={onClose} disabled={busy} className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap">
            Cancel
          </button>
          <button
            onClick={handleMove}
            disabled={busy || isCurrentParent}
            className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] shrink-0 whitespace-nowrap"
          >
            {busy ? "Moving…" : "Move here"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
