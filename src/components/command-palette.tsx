"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Image01Icon from "@hugeicons/core-free-icons/Image01Icon";
import Table01Icon from "@hugeicons/core-free-icons/Table01Icon";
import Pdf01Icon from "@hugeicons/core-free-icons/Pdf01Icon";
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon";
import Upload04Icon from "@hugeicons/core-free-icons/Upload04Icon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import Setting07Icon from "@hugeicons/core-free-icons/Setting07Icon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import ArrowTurnDownIcon from "@hugeicons/core-free-icons/ArrowTurnDownIcon";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface SearchItem {
  id: string;
  label: string;
  icon: unknown;
  iconColor: string;
  section: "recent" | "files" | "actions";
  shortcut?: string;
}

const recentFiles: SearchItem[] = [
  { id: "r1", label: "Architecture Diagram.pdf", icon: Pdf01Icon, iconColor: "var(--accent-red-primary)", section: "recent" },
  { id: "r2", label: "Q1 overview", icon: Folder01Icon, iconColor: "var(--accent-blue-primary)", section: "recent" },
  { id: "r3", label: "CapTable.xls", icon: Table01Icon, iconColor: "var(--accent-green-primary)", section: "recent" },
];

const allFiles: SearchItem[] = [
  { id: "f1", label: "Q1 overview", icon: Folder01Icon, iconColor: "var(--accent-blue-primary)", section: "files" },
  { id: "f2", label: "Milestones", icon: Folder01Icon, iconColor: "var(--accent-blue-primary)", section: "files" },
  { id: "f3", label: "Team review.docx", icon: File01Icon, iconColor: "var(--accent-dark-blue-primary)", section: "files" },
  { id: "f4", label: "BG-02.png", icon: Image01Icon, iconColor: "var(--accent-green-primary)", section: "files" },
  { id: "f5", label: "FetchTable.py", icon: CodeIcon, iconColor: "var(--accent-orange-primary)", section: "files" },
  { id: "f6", label: "CapTable.xls", icon: Table01Icon, iconColor: "var(--accent-green-primary)", section: "files" },
  { id: "f7", label: "Architecture Diagram.pdf", icon: Pdf01Icon, iconColor: "var(--accent-red-primary)", section: "files" },
  { id: "f8", label: "Pitch Deck.pptx", icon: File01Icon, iconColor: "var(--accent-orange-primary)", section: "files" },
];

const quickActions: SearchItem[] = [
  { id: "a1", label: "Upload file", icon: Upload04Icon, iconColor: "var(--icon-secondary)", section: "actions", shortcut: "U" },
  { id: "a2", label: "New folder", icon: FolderAddIcon, iconColor: "var(--icon-secondary)", section: "actions", shortcut: "N" },
  { id: "a3", label: "Invite member", icon: UserAdd01Icon, iconColor: "var(--icon-secondary)", section: "actions", shortcut: "I" },
  { id: "a4", label: "Settings", icon: Setting07Icon, iconColor: "var(--icon-secondary)", section: "actions" },
  { id: "a5", label: "Starred files", icon: StarIcon, iconColor: "var(--icon-secondary)", section: "actions" },
  { id: "a6", label: "Trash", icon: Delete02Icon, iconColor: "var(--icon-secondary)", section: "actions" },
];

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Keyboard shortcut to open (Cmd+K)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (!open) {
          // parent handles opening
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const results = useMemo(() => {
    if (!query.trim()) {
      return { recent: recentFiles, actions: quickActions, files: [] };
    }
    const q = query.toLowerCase();
    const matchedFiles = allFiles.filter((f) => f.label.toLowerCase().includes(q));
    const matchedActions = quickActions.filter((a) => a.label.toLowerCase().includes(q));
    return { recent: [], actions: matchedActions, files: matchedFiles };
  }, [query]);

  const flatResults = [...results.recent, ...results.files, ...results.actions];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flatResults.length > 0) {
      e.preventDefault();
      onClose();
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
              onClick={onClose}
              className={`w-full flex items-center gap-3 px-4 h-[36px] text-[13px] transition-colors cursor-pointer ${
                selectedIndex === idx ? "bg-bg-overlay-tertiary" : ""
              }`}
            >
              <HugeiconsIcon icon={item.icon as Parameters<typeof HugeiconsIcon>[0]["icon"]} size={16} color={item.iconColor} />
              <span className={`flex-1 text-left truncate ${selectedIndex === idx ? "text-text-primary" : "text-text-secondary"}`}>
                {item.label}
              </span>
              {item.shortcut && (
                <kbd className="text-[10px] font-mono text-text-disabled bg-bg-field px-1.5 py-0.5 rounded">
                  {item.shortcut}
                </kbd>
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

  let offset = 0;
  const recentStart = offset; offset += results.recent.length;
  const filesStart = offset; offset += results.files.length;
  const actionsStart = offset;

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
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
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
          {flatResults.length === 0 && query.trim() && (
            <div className="flex flex-col items-center justify-center py-10 text-text-disabled">
              <HugeiconsIcon icon={Search01Icon} size={24} color="var(--icon-tertiary)" />
              <p className="text-[13px] mt-2">No results for &ldquo;{query}&rdquo;</p>
            </div>
          )}
          {renderSection("Recent", results.recent, recentStart)}
          {renderSection("Files", results.files, filesStart)}
          {renderSection("Actions", results.actions, actionsStart)}
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
