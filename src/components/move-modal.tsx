"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Move01Icon from "@hugeicons/core-free-icons/Move01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import Location01Icon from "@hugeicons/core-free-icons/Location01Icon";
import type { DecryptedFile } from "@/hooks/use-files";
import { useFilesContext } from "@/hooks/use-files";
import {
  unwrapPrivateHierarchicalKey,
  unwrapSessionKeyFromFile,
  unwrapParentKeysClaim,
  decryptMetadata,
  type HybridPrivateKeys,
} from "@/lib/crypto/file-crypto";

interface MoveModalProps {
  file: DecryptedFile | null;
  onClose: () => void;
}

interface FolderEntry {
  id: string;
  name: string;
  publicHierarchicalKey: string;
  publicKemHierarchicalKey: string;
  // Kept so navigating INTO this folder can populate the path's
  // privateHierarchicalKey — which is what makes subsequent
  // inheritance-fallback decrypts work for grandchildren.
  privateHierarchicalKey: HybridPrivateKeys | null;
}

interface PathEntry {
  id: string | null;
  name: string;
  publicHierarchicalKey: string | null;
  publicKemHierarchicalKey: string | null;
  // Present for every non-root path entry. Used as the fallback
  // parent key when a child folder has no direct file_keys row
  // (inherited access, e.g. workspace subtrees the user can see
  // but wasn't individually granted on).
  privateHierarchicalKey: HybridPrivateKeys | null;
}

export function MoveModal({ file, onClose }: MoveModalProps) {
  const fileOps = useFilesContext();
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<PathEntry[]>([
    { id: null, name: "My Drive", publicHierarchicalKey: null, publicKemHierarchicalKey: null, privateHierarchicalKey: null },
  ]);
  // Client-side filter — scoped to the currently-viewed folder, not
  // a recursive search. Keeps the crypto boundary clean: no server
  // query needed, no exposure of encrypted names.
  const [query, setQuery] = useState("");
  // Inline "+ New folder" input. Hidden by default; shown when the
  // user clicks the New folder button inside the picker.
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const current = path[path.length - 1];

  /**
   * "Currently in: …" string for the header. Resolves the file's
   * existing home so users don't have to cancel and remember the
   * path themselves before deciding where to move.
   *
   * Priority:
   *   - Root-level file in personal drive → "My Drive"
   *   - Root-level file in a workspace → workspace name
   *   - Nested file → look up parent by id in fileOps.files
   *     (which holds the currently-browsed folder's contents —
   *     usually matches the file's parent in the 99% case the user
   *     right-clicked from the file's own folder). Fall back to
   *     "Another folder" if we can't resolve.
   */
  const currentLocation = useMemo(() => {
    if (!file) return null;
    if (!file.parentId) {
      return fileOps.activeWorkspace?.name ?? "My Drive";
    }
    // 99% case: the user is viewing the folder the file lives in, so
    // the file's parent matches the last breadcrumb segment. That
    // segment has the decrypted folder name we need.
    const last = fileOps.breadcrumb[fileOps.breadcrumb.length - 1];
    if (last?.id === file.parentId) return last.name;
    // Fallback: file might be rendered from a cross-folder source
    // (e.g. search results, Recent). Look up siblings just in case.
    const parent = fileOps.files.find((f) => f.id === file.parentId);
    return parent?.name ?? "Another folder";
  }, [file, fileOps.files, fileOps.activeWorkspace, fileOps.breadcrumb]);

  // Filtered list — case-insensitive substring match on decrypted
  // folder names. Empty query shows everything.
  const visibleFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, query]);

  const fetchFolders = useCallback(
    async (parentId: string | null, parentPrivHier: HybridPrivateKeys | null) => {
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
        const { encryptionPrivateKey, kemPrivateKey } = JSON.parse(keysStr) as {
          encryptionPrivateKey: string;
          kemPrivateKey: string;
        };

        const result: FolderEntry[] = [];
        for (const f of data.files) {
          if (!f.is_folder) continue;
          if (file && f.id === file.id) continue;
          const encPrivHier = f.encrypted_private_hierarchical_key || "";
          const wrappedBy = f.wrapped_by_public_key || "";
          const ownerPub = f.owner_public_key || "";
          let sessionKey: Uint8Array | null = null;
          let folderPrivHier: HybridPrivateKeys | null = null;

          try {
            if (encPrivHier) {
              // Direct key path — user has their own file_keys row.
              folderPrivHier = unwrapPrivateHierarchicalKey(
                encPrivHier,
                wrappedBy,
                encryptionPrivateKey,
                kemPrivateKey,
              );
              sessionKey = unwrapSessionKeyFromFile(
                f.encrypted_session_key_by_file,
                f.session_key_nonce,
                ownerPub,
                folderPrivHier,
              );
            } else if (
              parentPrivHier &&
              f.parent_keys_claim &&
              f.parent_keys_claim_wrapped_by
            ) {
              // Inherited-key path — no direct file_keys row, but the
              // parent's priv hier key unlocks the claim which yields
              // this folder's session key + its own priv hier. Matches
              // the main drive's decryption behavior so workspace
              // subtrees and shared folders show up as move targets.
              const unwrapped = unwrapParentKeysClaim(
                f.parent_keys_claim,
                f.parent_keys_claim_wrapped_by,
                parentPrivHier,
              );
              sessionKey = unwrapped.sessionKey;
              folderPrivHier = unwrapped.childPrivateHierarchicalKeys;
            } else {
              // Can't decrypt either way — skip silently, don't block
              // the whole list render on one bad row.
              continue;
            }

            const encMeta =
              typeof f.encrypted_metadata === "string"
                ? JSON.parse(f.encrypted_metadata)
                : f.encrypted_metadata;
            const meta = decryptMetadata(encMeta, sessionKey);
            result.push({
              id: f.id,
              name: meta.name,
              publicHierarchicalKey: f.public_hierarchical_key,
              publicKemHierarchicalKey: f.public_kem_hierarchical_key,
              privateHierarchicalKey: folderPrivHier,
            });
          } catch {
            /* skip unreadable */
          } finally {
            if (sessionKey) sessionKey.fill(0);
          }
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
    setQuery("");
    setNewFolderMode(false);
    setNewFolderName("");
    if (fileOps.activeWorkspace) {
      // In workspace context, start at the workspace root. We need
      // BOTH the root folder's public hier key (to wrap session keys
      // during a move) AND its private hier key (to unwrap children
      // that don't have direct file_keys rows — i.e. inherited
      // access). chunk-download returns both.
      fetch(`/api/files/chunk-download?fileId=${fileOps.activeWorkspace.rootFolderId}`)
        .then((r) => r.json())
        .then((d) => {
          let rootPrivHier: HybridPrivateKeys | null = null;
          try {
            const keysStr = sessionStorage.getItem("securewarp_keys");
            if (keysStr && d.encryptedPrivateHierarchicalKey) {
              const { encryptionPrivateKey, kemPrivateKey } = JSON.parse(keysStr) as {
                encryptionPrivateKey: string;
                kemPrivateKey: string;
              };
              rootPrivHier = unwrapPrivateHierarchicalKey(
                d.encryptedPrivateHierarchicalKey,
                d.wrappedByPublicKey,
                encryptionPrivateKey,
                kemPrivateKey,
              );
            }
          } catch { /* leave null; children without direct keys won't decrypt */ }
          setPath([{
            id: fileOps.activeWorkspace!.rootFolderId,
            name: fileOps.activeWorkspace!.name,
            publicHierarchicalKey: d.publicHierarchicalKey || null,
            publicKemHierarchicalKey: d.publicKemHierarchicalKey || null,
            privateHierarchicalKey: rootPrivHier,
          }]);
          fetchFolders(fileOps.activeWorkspace!.rootFolderId, rootPrivHier);
        })
        .catch(() => {
          setPath([{
            id: fileOps.activeWorkspace!.rootFolderId,
            name: fileOps.activeWorkspace!.name,
            publicHierarchicalKey: null,
            publicKemHierarchicalKey: null,
            privateHierarchicalKey: null,
          }]);
          fetchFolders(fileOps.activeWorkspace!.rootFolderId, null);
        });
    } else {
      setPath([{ id: null, name: "My Drive", publicHierarchicalKey: null, publicKemHierarchicalKey: null, privateHierarchicalKey: null }]);
      fetchFolders(null, null);
    }
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!file) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [file, onClose, busy]);

  if (!file) return null;


  const navigateUp = () => {
    if (path.length <= 1) return;
    const newPath = path.slice(0, -1);
    setPath(newPath);
    const tail = newPath[newPath.length - 1];
    fetchFolders(tail.id, tail.privateHierarchicalKey);
    setQuery("");
  };

  // Clear the filter on folder navigation so the next folder view
  // shows all of its children, not the stale query's filter.
  const wrappedNavigateInto = (folder: FolderEntry) => {
    setQuery("");
    setPath((p) => [
      ...p,
      {
        id: folder.id,
        name: folder.name,
        publicHierarchicalKey: folder.publicHierarchicalKey,
        publicKemHierarchicalKey: folder.publicKemHierarchicalKey,
        privateHierarchicalKey: folder.privateHierarchicalKey,
      },
    ]);
    fetchFolders(folder.id, folder.privateHierarchicalKey);
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    setError(null);
    try {
      // Create inside the currently-browsed folder. The useFiles hook
      // does the full crypto setup (new hier keypair, parent claim,
      // etc.) and surfaces any failure via its own error state; no
      // explicit return value is needed.
      await fileOps.createFolder(name, current.id);
      setNewFolderMode(false);
      setNewFolderName("");
      // Refresh the picker so the new folder shows up immediately.
      await fetchFolders(current.id, current.privateHierarchicalKey);
    } catch {
      setError("Failed to create folder");
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleMove = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const result = await fileOps.moveFile(
      file,
      current.id,
      current.publicHierarchicalKey,
      current.publicKemHierarchicalKey,
    );
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

        {/* Currently-in indicator — gives the user context for the
            move decision without making them cancel-and-remember. */}
        {currentLocation && (
          <div className="flex items-center gap-2 px-5 pt-3 pb-1 text-[11px] text-text-tertiary">
            <HugeiconsIcon icon={Location01Icon} size={12} color="var(--icon-tertiary)" />
            <span>Currently in </span>
            <span className="text-text-secondary font-medium truncate">{currentLocation}</span>
          </div>
        )}

        {/* Breadcrumb — picker path (not the file's current path) */}
        <div className="flex items-center gap-1 px-5 pt-3 text-[12px] text-text-tertiary overflow-x-auto">
          {path.map((seg, i) => (
            <span key={seg.id ?? "root"} className="flex items-center gap-1 shrink-0">
              {i > 0 && <span className="text-text-disabled">/</span>}
              <button
                onClick={() => {
                  if (i === path.length - 1) return;
                  const newPath = path.slice(0, i + 1);
                  setPath(newPath);
                  const tail = newPath[newPath.length - 1];
                  fetchFolders(tail.id, tail.privateHierarchicalKey);
                  setQuery("");
                }}
                className={`hover:text-text-secondary transition-colors cursor-pointer ${i === path.length - 1 ? "text-text-primary font-medium" : ""}`}
              >
                {seg.name}
              </button>
            </span>
          ))}
        </div>

        {/* Search + New folder — row of utility actions above the list */}
        <div className="flex items-center gap-2 px-5 pt-3">
          <div className="relative flex-1">
            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-icon-tertiary pointer-events-none">
              <HugeiconsIcon icon={Search01Icon} size={13} />
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter folders…"
              className="w-full h-[32px] pl-8 pr-2.5 rounded-[8px] bg-bg-field text-[12px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 border border-transparent focus:border-accent-green/40 transition-all"
            />
          </div>
          <button
            onClick={() => {
              setNewFolderMode(true);
              setTimeout(() => newFolderInputRef.current?.focus(), 30);
            }}
            disabled={newFolderMode || busy}
            title="New folder here"
            className="h-[32px] px-2.5 rounded-[8px] text-[11px] font-medium text-text-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer inline-flex items-center gap-1 border border-border-tertiary disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <HugeiconsIcon icon={FolderAddIcon} size={13} />
            New
          </button>
        </div>

        {/* Inline new-folder input. Appears when the user clicks New.
            Enter confirms, Escape cancels. */}
        {newFolderMode && (
          <div className="flex items-center gap-2 px-5 pt-2">
            <input
              ref={newFolderInputRef}
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                else if (e.key === "Escape") {
                  setNewFolderMode(false);
                  setNewFolderName("");
                }
              }}
              placeholder="Folder name"
              maxLength={100}
              className="flex-1 h-[32px] px-3 rounded-[8px] bg-bg-field text-[12px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 border border-transparent focus:border-accent-green/40 transition-all"
            />
            <button
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim() || creatingFolder}
              className="h-[32px] px-3 rounded-[8px] text-[11px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {creatingFolder ? "…" : "Create"}
            </button>
            <button
              onClick={() => {
                setNewFolderMode(false);
                setNewFolderName("");
              }}
              disabled={creatingFolder}
              className="h-[32px] px-2.5 rounded-[8px] text-[11px] text-text-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer shrink-0"
            >
              Cancel
            </button>
          </div>
        )}

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
          ) : visibleFolders.length === 0 ? (
            <div className="flex items-center justify-center h-[100px]">
              <span className="text-[12px] text-text-disabled">
                No folders match &ldquo;{query}&rdquo;
              </span>
            </div>
          ) : (
            visibleFolders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => wrappedNavigateInto(folder)}
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
