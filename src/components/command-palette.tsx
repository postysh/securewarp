"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Upload04Icon from "@hugeicons/core-free-icons/Upload04Icon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import Setting07Icon from "@hugeicons/core-free-icons/Setting07Icon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import ArrowTurnDownIcon from "@hugeicons/core-free-icons/ArrowTurnDownIcon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import { useFilesContext } from "@/hooks/use-files";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onAction?: (action: string) => void;
  onOpenFile?: (fileId: string, isFolder: boolean, name?: string) => void;
}

interface SearchItem {
  id: string;
  label: string;
  icon: unknown;
  iconColor: string;
  section: "files" | "actions";
  isFolder?: boolean;
  // Workspace context for file results — null for personal-drive
  // matches, set to the workspace name for any file living inside a
  // workspace. Used to render the "from <workspace>" badge.
  workspaceName?: string | null;
}

const quickActions: SearchItem[] = [
  { id: "a1", label: "Upload file", icon: Upload04Icon, iconColor: "var(--icon-secondary)", section: "actions" },
  { id: "a2", label: "New folder", icon: FolderAddIcon, iconColor: "var(--icon-secondary)", section: "actions" },
  { id: "a3", label: "Invite member", icon: UserAdd01Icon, iconColor: "var(--icon-secondary)", section: "actions" },
  { id: "a4", label: "Settings", icon: Setting07Icon, iconColor: "var(--icon-secondary)", section: "actions" },
  { id: "a5", label: "Starred files", icon: StarIcon, iconColor: "var(--icon-secondary)", section: "actions" },
  { id: "a6", label: "Trash", icon: Delete02Icon, iconColor: "var(--icon-secondary)", section: "actions" },
];

export function CommandPalette({ open, onClose, onAction, onOpenFile }: CommandPaletteProps) {
  const fileOps = useFilesContext();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setSearchResults([]);
      setSearching(false);
      setTimeout(() => inputRef.current?.focus(), 50);
      // Rebuild the search cache on open if it's older than the
      // hook's TTL (2 min). The cache's per-item upsert path keeps
      // things fresh for local operations, but workspaces / other
      // tabs / background changes drift it — rebuild on open catches
      // that drift without users needing to know they should.
      void fileOps.refreshSearchCacheIfStale?.();
    }
  }, [open, fileOps]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Sequence counter so stale responses don't overwrite newer
  // results. If the user types fast enough that a slow cache-build
  // is in flight for an older query, we ignore its results when it
  // finally resolves.
  const searchSeqRef = useRef(0);

  const doSearch = useCallback(
    async (q: string) => {
      const mySeq = ++searchSeqRef.current;
      if (!q.trim()) {
        setSearchResults([]);
        setSearching(false);
        return;
      }
      // Only show "Decrypting…" if the search takes meaningfully
      // longer than a frame — otherwise it flickers on every
      // keystroke. The in-memory path is synchronous-fast; the
      // spinner only surfaces during the initial cache build.
      const spinnerTimer = setTimeout(() => {
        if (searchSeqRef.current === mySeq) setSearching(true);
      }, 120);
      try {
        const results = await fileOps.searchFiles(q);
        if (searchSeqRef.current !== mySeq) return;
        setSearchResults(
          results.map((f) => ({
            id: f.id,
            label: f.name,
            icon: f.isFolder ? Folder01Icon : File01Icon,
            iconColor: f.isFolder ? "var(--accent-blue-primary)" : "var(--icon-secondary)",
            section: "files" as const,
            isFolder: f.isFolder,
            workspaceName: f.workspaceName,
          })),
        );
      } finally {
        clearTimeout(spinnerTimer);
        if (searchSeqRef.current === mySeq) setSearching(false);
      }
    },
    [fileOps],
  );

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 150);
  };

  const hasQuery = query.trim().length > 0;
  const fileResults = hasQuery ? searchResults : [];
  const actionResults = hasQuery
    ? quickActions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()))
    : quickActions;
  const flatResults = [...fileResults, ...actionResults];

  const handleSelect = (item: SearchItem) => {
    if (item.section === "actions" && onAction) {
      onAction(item.id);
    } else if (item.section === "files" && onOpenFile) {
      onOpenFile(item.id, item.isFolder ?? false, item.label);
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flatResults.length > 0) {
      e.preventDefault();
      const item = flatResults[selectedIndex];
      if (item) handleSelect(item);
    }
  };

  if (!open) return null;

  const renderSection = (title: string, items: SearchItem[], startIndex: number) => {
    if (items.length === 0) return null;
    return (
      <div className="py-1">
        <p className="text-[10px] font-mono uppercase text-text-disabled tracking-wider px-4 py-1.5">{title}</p>
        {items.map((item, i) => {
          const idx = startIndex + i;
          return (
            <button
              key={item.id}
              onMouseEnter={() => setSelectedIndex(idx)}
              onClick={() => handleSelect(item)}
              className={`w-full flex items-center gap-3 px-4 h-[36px] text-[13px] transition-colors cursor-pointer ${
                selectedIndex === idx ? "bg-bg-overlay-tertiary" : ""
              }`}
            >
              <HugeiconsIcon icon={item.icon as Parameters<typeof HugeiconsIcon>[0]["icon"]} size={16} color={item.iconColor} />
              <span className={`flex-1 text-left truncate ${selectedIndex === idx ? "text-text-primary" : "text-text-secondary"}`}>
                {item.label}
              </span>
              {item.section === "files" && item.workspaceName && (
                <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-bg-field text-text-tertiary truncate max-w-[140px]">
                  {item.workspaceName}
                </span>
              )}
              {item.section === "files" && item.workspaceName === null && (
                <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-bg-field text-text-tertiary">
                  My Drive
                </span>
              )}
              {selectedIndex === idx && (
                <HugeiconsIcon icon={ArrowTurnDownIcon} size={12} color="var(--icon-tertiary)" />
              )}
            </button>
          );
        })}
      </div>
    );
  };

  const filesStart = 0;
  const actionsStart = fileResults.length;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh]">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div
        className="relative w-full max-w-[520px] mx-4 rounded-2xl bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 h-[48px] border-b border-border-tertiary">
          <HugeiconsIcon icon={Search01Icon} size={16} color="var(--icon-tertiary)" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files, folders, and actions..."
            className="flex-1 bg-transparent text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none"
          />
          <kbd className="text-[10px] font-mono text-text-disabled bg-bg-field px-1.5 py-0.5 rounded">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-y-auto">
          {searching && (
            <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-text-disabled">
              <HugeiconsIcon icon={LockIcon} size={12} />
              Decrypting file names…
            </div>
          )}
          {!searching && hasQuery && flatResults.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-text-disabled">
              <HugeiconsIcon icon={Search01Icon} size={24} color="var(--icon-tertiary)" />
              <p className="text-[13px] mt-2">No results for &ldquo;{query}&rdquo;</p>
            </div>
          )}
          {renderSection(hasQuery ? "Files" : "Actions", hasQuery ? fileResults : [], filesStart)}
          {renderSection("Actions", actionResults, actionsStart)}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 h-[36px] border-t border-border-tertiary text-[10px] text-text-disabled">
          <div className="flex items-center gap-1">
            <kbd className="font-mono bg-bg-field px-1 py-0.5 rounded">↑↓</kbd>
            navigate
          </div>
          <div className="flex items-center gap-1">
            <kbd className="font-mono bg-bg-field px-1 py-0.5 rounded">↵</kbd>
            open
          </div>
          <div className="flex items-center gap-1">
            <kbd className="font-mono bg-bg-field px-1 py-0.5 rounded">esc</kbd>
            close
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
