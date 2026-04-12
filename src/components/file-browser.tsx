"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import ArrowUp01Icon from "@hugeicons/core-free-icons/ArrowUp01Icon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import Share01Icon from "@hugeicons/core-free-icons/Share01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import Upload04Icon from "@hugeicons/core-free-icons/Upload04Icon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import SidebarLeft01Icon from "@hugeicons/core-free-icons/SidebarLeft01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import Edit02Icon from "@hugeicons/core-free-icons/Edit02Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import Move01Icon from "@hugeicons/core-free-icons/Move01Icon";
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import MinusSignIcon from "@hugeicons/core-free-icons/MinusSignIcon";
import { NotificationBell } from "./notifications";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import { FileIcon, type FileKind } from "./file-icon";
import { Tooltip } from "./tooltip";
import { Facepile } from "./facepile";
import { CommandPalette } from "./command-palette";
import { NewFolderModal } from "./new-folder-modal";
import { ShareModal } from "./share-modal";
import { RenameModal } from "./rename-modal";
import { MoveModal } from "./move-modal";
import { FilePreview } from "./file-preview";
import { ConfirmDialog } from "./confirm-dialog";
import { MembersModal } from "./members-modal";
import { useFilesContext, type DecryptedFile, type FileCollaboratorPreview } from "@/hooks/use-files";
import { initialsFromEmail, colorForEmail } from "@/lib/avatar";
import { useUserKeys } from "@/hooks/use-user-keys";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import HardDriveIcon from "@hugeicons/core-free-icons/HardDriveIcon";

function getFileKind(name: string, type: string): FileKind {
  if (type === "folder") return "folder";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, FileKind> = {
    pdf: "pdf", doc: "document", docx: "document", txt: "document", md: "document",
    png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image", webp: "image",
    js: "code", ts: "code", py: "code", rb: "code", go: "code", rs: "code", jsx: "code", tsx: "code",
    xls: "spreadsheet", xlsx: "spreadsheet", csv: "spreadsheet",
    mp3: "audio", wav: "audio", ogg: "audio", flac: "audio",
    mp4: "video", mov: "video", avi: "video", mkv: "video",
    zip: "archive", tar: "archive", gz: "archive", rar: "archive", "7z": "archive",
    pptx: "presentation", ppt: "presentation", key: "presentation",
  };
  return map[ext] || "other";
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(size < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type SortField = "name" | "type" | "size" | "modified";

function roleLabel(c: FileCollaboratorPreview): string {
  if (c.isOwner) return "Owner";
  if (c.permissionLevel === "viewer") return "Viewer";
  return "Editor";
}

function CollaboratorAvatar({ c, size = 24 }: { c: FileCollaboratorPreview; size?: number }) {
  const textSize = size >= 28 ? "10px" : "9px";
  const content = (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12px] text-text-primary font-medium truncate">{c.email || "Unknown"}</span>
      <span className="text-[11px] text-text-disabled">{roleLabel(c)}</span>
    </div>
  );
  return (
    <Tooltip label={c.email || "Unknown"} content={content} side="bottom">
      <div
        className="rounded-full border-2 border-bg-main flex items-center justify-center font-bold text-white"
        style={{
          width: size,
          height: size,
          backgroundColor: colorForEmail(c.email),
          fontSize: textSize,
        }}
      >
        {initialsFromEmail(c.email)}
      </div>
    </Tooltip>
  );
}

function CollaboratorStack({ collaborators }: { collaborators: FileCollaboratorPreview[] }) {
  if (!collaborators || collaborators.length === 0) {
    return <span className="text-[11px] text-text-disabled">Private</span>;
  }
  // A lone owner means nobody else has access — treat as private so the
  // owner's own avatar doesn't feel like the file has "members".
  if (collaborators.length === 1 && collaborators[0].isOwner) {
    return <span className="text-[11px] text-text-disabled">Private</span>;
  }

  const MAX = 3;
  const visible = collaborators.slice(0, MAX);
  const overflow = collaborators.slice(MAX);
  const overflowContent = (
    <div className="flex flex-col gap-1">
      {overflow.map((c) => (
        <div key={c.userId} className="flex flex-col">
          <span className="text-[12px] text-text-primary truncate">{c.email || "Unknown"}</span>
          <span className="text-[11px] text-text-disabled">{roleLabel(c)}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex items-center -space-x-1.5">
      {visible.map((c) => (
        <CollaboratorAvatar key={c.userId} c={c} />
      ))}
      {overflow.length > 0 && (
        <Tooltip label={`+${overflow.length} more`} content={overflowContent} side="bottom">
          <div className="w-6 h-6 rounded-full border-2 border-bg-main bg-bg-field flex items-center justify-center text-[9px] font-bold text-text-tertiary">
            +{overflow.length}
          </div>
        </Tooltip>
      )}
    </div>
  );
}

export function FileBrowser({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const keys = useUserKeys();
  const fileOps = useFilesContext();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<DecryptedFile | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragFileId, setDragFileId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fileId: string; isFolder: boolean } | null>(null);
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);
  const [emptyTrashBusy, setEmptyTrashBusy] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<DecryptedFile | null>(null);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<DecryptedFile | null>(null);
  const [renameTarget, setRenameTarget] = useState<DecryptedFile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Load files on mount and when keys become available
  useEffect(() => {
    if (keys) {
      fileOps.fetchFiles(fileOps.currentFolder);
    }
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close context menu when files/view changes
  useEffect(() => {
    setContextMenu(null);
  }, [fileOps.files, fileOps.viewMode, fileOps.currentFolder]);

  // Map decrypted files to display format
  const displayFiles = fileOps.files.map((f) => ({
    id: f.id,
    name: f.name,
    type: getFileKind(f.name, f.type),
    fileType: f.isFolder ? "FOLDER" : (f.name.split(".").pop()?.toUpperCase() || "FILE"),
    size: formatBytes(f.size),
    modified: formatDate(f.createdAt),
    isFolder: f.isFolder,
    uploading: f.uploading,
    uploadProgress: f.uploadProgress,
    collaborators: f.collaborators,
  }));

  const selectAll = () => setSelected(new Set(displayFiles.map((f) => f.id)));
  const selectNone = () => setSelected(new Set());
  const allSelected = displayFiles.length > 0 && selected.size === displayFiles.length;
  const someSelected = selected.size > 0 && !allSelected;

  // Mobile bottom nav search trigger
  useEffect(() => {
    const openSearch = () => setCommandPaletteOpen(true);
    window.addEventListener("securewarp-open-search", openSearch);
    return () => window.removeEventListener("securewarp-open-search", openSearch);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
        return;
      }
      // Remaining shortcuts only fire outside form fields and modals
      if (inInput) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        selectAll();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected.size > 0) {
        e.preventDefault();
        const ids = [...selected];
        selectNone();
        (async () => {
          for (const id of ids) await fileOps.deleteItem(id);
        })();
        return;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selected, selectAll, selectNone, fileOps]);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    // Drag-drop uploads only make sense in the owned drive. In "Shared with
    // me" the user has no write target — silently drop the files.
    if (fileOps.viewMode === "shared" || fileOps.viewMode === "trash") return;
    // Ignore internal file-move drags (they set text/plain with a UUID).
    if (e.dataTransfer.types.includes("text/plain") && !e.dataTransfer.files.length) return;
    const files = e.dataTransfer.files;
    if (!files.length) return;
    for (const file of Array.from(files)) {
      await fileOps.uploadFile(file, fileOps.currentFolder);
    }
  }, [fileOps]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  };

  const SortArrow = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return <HugeiconsIcon icon={sortAsc ? ArrowUp01Icon : ArrowDown01Icon} size={12} />;
  };

  return (
    <div
      className="flex-1 flex flex-col h-full overflow-hidden bg-bg-main relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={async (e) => {
        const files = e.target.files;
        if (!files) return;
        for (const file of Array.from(files)) {
          await fileOps.uploadFile(file, fileOps.currentFolder);
        }
        e.target.value = "";
      }} />

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-bg-cell-active border-2 border-dashed border-accent-green rounded-xl m-2 animate-fade-in">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-[10px] bg-accent-green-bg flex items-center justify-center">
              <HugeiconsIcon icon={Upload04Icon} size={24} color="var(--accent-green-primary)" />
            </div>
            <div className="text-center">
              <p className="text-[14px] font-medium text-text-primary">Drop files to upload</p>
              <p className="text-[12px] text-text-tertiary mt-0.5">Files will be end-to-end encrypted</p>
            </div>
          </div>
        </div>
      )}

      {/* Header bar */}
      <div className="relative flex items-center justify-between px-3 md:px-5 h-[52px] shrink-0">
        {/* Left: sidebar toggle + breadcrumb */}
        <div className="flex items-center gap-1.5 text-[13px] shrink-0 z-10 min-w-0 overflow-hidden">
          <button onClick={onToggleSidebar} className="hidden md:block p-1.5 rounded-md text-icon-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer mr-1">
            <HugeiconsIcon icon={SidebarLeft01Icon} size={16} />
          </button>
          {/* Mobile breadcrumb: back arrow + current name */}
          <div className="flex md:hidden items-center gap-1.5 min-w-0">
            {fileOps.breadcrumb.length > 1 && (
              <button
                onClick={() => fileOps.navigateToBreadcrumb(fileOps.breadcrumb.length - 2)}
                className="p-1 rounded-md text-icon-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer shrink-0"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
              </button>
            )}
            <span className="text-text-primary font-medium truncate">
              {fileOps.breadcrumb[fileOps.breadcrumb.length - 1]?.name ?? "My Drive"}
            </span>
          </div>
          {/* Desktop breadcrumb: full path */}
          <div className="hidden md:flex items-center gap-1.5">
          {(() => {
            const crumbs = fileOps.breadcrumb;
            const maxVisible = 3;
            const collapsed = crumbs.length > maxVisible;
            const visible = collapsed ? [crumbs[0], ...crumbs.slice(-2)] : crumbs;

            return visible.map((crumb, i) => (
              <span key={`${i}-${crumb.id ?? "root"}`} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-text-disabled">/</span>}
                {i === 1 && collapsed && (
                  <>
                    <span className="text-text-disabled">...</span>
                    <span className="text-text-disabled">/</span>
                  </>
                )}
                {(i < visible.length - 1) ? (
                  <button onClick={() => fileOps.navigateToBreadcrumb(collapsed && i > 0 ? crumbs.length - (visible.length - i) : i)} className="text-text-secondary hover:text-text-primary cursor-pointer transition-colors bg-transparent border-none p-0 text-[13px]">
                    {crumb.name}
                  </button>
                ) : (
                  <span className="text-text-primary font-medium">{crumb.name}</span>
                )}
              </span>
            ));
          })()}
          </div>
        </div>

        {/* Center: search trigger (hidden on mobile, use Cmd+K or search icon) */}
        <div className="absolute inset-0 hidden md:flex items-center justify-center pointer-events-none">
          <button
            onClick={() => setCommandPaletteOpen(true)}
            className="flex h-8 w-full max-w-[360px] items-center rounded-lg bg-bg-overlay-tertiary px-3 gap-2 text-text-disabled text-[13px] cursor-pointer pointer-events-auto hover:bg-bg-cell-hover transition-colors"
          >
            <HugeiconsIcon icon={Search01Icon} size={15} />
            <span className="flex-1 text-left">Search files and actions...</span>
            <kbd className="text-[10px] font-mono bg-bg-field px-1.5 py-0.5 rounded">⌘K</kbd>
          </button>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1 md:gap-2 shrink-0 z-10">
          {/* Facepile */}
          <div className="hidden md:block">
            <Facepile onClick={() => setMembersOpen(true)} onOverflowClick={() => setMembersOpen(true)} />
          </div>
          {fileOps.viewMode === "own" && (
            <button
              onClick={() => {
                const first = fileOps.files.find((f) => selected.has(f.id));
                if (first) setShareTarget(first);
              }}
              className="hidden md:flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={UserAdd01Icon} size={14} />
              Invite
            </button>
          )}
          {(fileOps.viewMode === "own" || fileOps.currentFolder) && fileOps.viewMode !== "trash" && fileOps.callerPermission !== "viewer" && (
            <>
              <button onClick={() => setNewFolderOpen(true)} className="hidden md:flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer">
                <HugeiconsIcon icon={FolderAddIcon} size={14} />
                New folder
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="hidden md:flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] text-[12px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-opacity cursor-pointer">
                <HugeiconsIcon icon={Upload04Icon} size={14} />
                Upload
              </button>
            </>
          )}
          {fileOps.viewMode === "trash" && fileOps.files.length > 0 && (
            <button
              onClick={() => setEmptyTrashOpen(true)}
              className="flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] text-[12px] font-medium text-accent-red border border-accent-red/30 hover:bg-accent-red/10 transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} />
              Empty trash
            </button>
          )}
          <NotificationBell />
        </div>
      </div>


      {/* Error banner */}
      {fileOps.error && (
        <div className="mx-5 mt-2 flex items-center justify-between px-3 py-2 rounded-lg bg-accent-red/10 border border-accent-red/20 animate-fade-in">
          <span className="text-[12px] text-accent-red">{fileOps.error}</span>
          <button onClick={() => fileOps.clearError()} className="text-[11px] text-accent-red/60 hover:text-accent-red transition-colors cursor-pointer ml-3 shrink-0">Dismiss</button>
        </div>
      )}


      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="hidden md:flex mx-5 mt-2 items-center gap-3 px-4 h-[36px] rounded-[8px] bg-bg-overlay-tertiary text-[12px] text-text-secondary animate-fade-in">
          <span className="font-medium text-text-primary">{selected.size} selected</span>
          <button onClick={selectNone} className="text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer">Clear</button>
          <button onClick={selectAll} className="text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer">Select all</button>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={async () => {
                for (const id of selected) {
                  const f = fileOps.files.find((x) => x.id === id);
                  if (f && !f.isFolder) await fileOps.downloadFile(id);
                }
              }}
              title="Download"
              className="p-1.5 rounded-md hover:bg-cta-nav-hover transition-colors cursor-pointer text-icon-secondary"
            >
              <HugeiconsIcon icon={Download04Icon} size={15} />
            </button>
            <button
              onClick={() => {
                const first = fileOps.files.find((f) => selected.has(f.id));
                if (first) setShareTarget(first);
              }}
              title="Share"
              className="p-1.5 rounded-md hover:bg-cta-nav-hover transition-colors cursor-pointer text-icon-secondary"
            >
              <HugeiconsIcon icon={Share01Icon} size={15} />
            </button>
            <button
              onClick={() => {
                const first = fileOps.files.find((f) => selected.has(f.id));
                if (first) setMoveTarget(first);
              }}
              title="Move"
              className="p-1.5 rounded-md hover:bg-cta-nav-hover transition-colors cursor-pointer text-icon-secondary"
            >
              <HugeiconsIcon icon={Move01Icon} size={15} />
            </button>
            <button
              onClick={async () => {
                const ids = [...selected];
                selectNone();
                for (const id of ids) await fileOps.deleteItem(id);
              }}
              title="Trash"
              className="p-1.5 rounded-md hover:bg-cta-nav-hover transition-colors cursor-pointer text-accent-red"
            >
              <HugeiconsIcon icon={Delete02Icon} size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-3 md:px-5 pb-4 flex flex-col" onClick={() => setContextMenu(null)}>
        {/* Table header — hide when empty, hide entirely on mobile */}
        {displayFiles.length > 0 && (
        <div className="hidden md:flex items-center h-[40px] px-4 box-border select-none">
          {/* Checkbox */}
          <button
            onClick={(e) => { e.stopPropagation(); allSelected || someSelected ? selectNone() : selectAll(); }}
            className={`w-[18px] h-[18px] rounded-[4px] border flex items-center justify-center mr-4 cursor-pointer transition-all shrink-0 ${
              allSelected || someSelected ? "border-accent-green bg-accent-green" : "border-border-primary hover:border-border-hover"
            }`}
          >
            {allSelected && <HugeiconsIcon icon={Tick01Icon} size={12} color="white" />}
            {someSelected && <HugeiconsIcon icon={MinusSignIcon} size={12} color="white" />}
          </button>
          <div className="flex items-center w-[80px] min-w-[80px] border-r border-border-secondary pr-4">
            <button onClick={() => toggleSort("name")} className="flex items-center gap-1 text-[11px] font-mono uppercase text-text-disabled hover:text-text-tertiary cursor-pointer transition-colors">
              Name <SortArrow field="name" />
            </button>
          </div>
          <div className="ml-auto flex items-center gap-[46px]">
            <div className="w-[100px] flex justify-end">
              <button onClick={() => toggleSort("type")} className="flex items-center gap-1 text-[11px] font-mono uppercase text-text-disabled hover:text-text-tertiary cursor-pointer transition-colors">
                Type <SortArrow field="type" />
              </button>
            </div>
            <div className="w-[100px] flex justify-end">
              <button onClick={() => toggleSort("size")} className="flex items-center gap-1 text-[11px] font-mono uppercase text-text-disabled hover:text-text-tertiary cursor-pointer transition-colors">
                Size <SortArrow field="size" />
              </button>
            </div>
            <div className="w-[110px] justify-end hidden md:flex">
              <span className="text-[11px] font-mono uppercase text-text-disabled">Shared</span>
            </div>
            <div className="w-[100px] justify-end hidden lg:flex">
              <button onClick={() => toggleSort("modified")} className="flex items-center gap-1 text-[11px] font-mono uppercase text-text-disabled hover:text-text-tertiary cursor-pointer transition-colors">
                Modified <SortArrow field="modified" />
              </button>
            </div>
          </div>
        </div>
        )}

        {/* Empty state */}
        {!fileOps.loading && fileOps.initialized && displayFiles.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-[360px]">
              {/* Visual — stacked floating cards */}
              <div className="relative w-[200px] h-[140px] mx-auto mb-8">
                {/* Back card */}
                <div className="absolute left-[19px] top-[16px] w-[150px] h-[80px] rounded-xl border border-border-tertiary bg-bg-side" />
                {/* Middle card */}
                <div className="absolute left-[14px] top-[6px] w-[160px] h-[90px] rounded-xl border border-border-tertiary bg-bg-l3 flex items-center justify-center">
                  <div className="flex items-center gap-2 px-3">
                    <div className="w-5 h-5 rounded bg-bg-overlay-tertiary" />
                    <div className="space-y-1.5">
                      <div className="w-20 h-1.5 rounded-full bg-bg-overlay-tertiary" />
                      <div className="w-12 h-1.5 rounded-full bg-bg-overlay-tertiary" />
                    </div>
                  </div>
                </div>
                {/* Front card */}
                <div className="absolute left-[26px] top-[28px] w-[160px] h-[90px] rounded-xl border border-border-tertiary bg-bg-main rotate-[3deg] flex flex-col items-center justify-center">
                  <div className="w-10 h-10 rounded-xl bg-accent-green/10 flex items-center justify-center mb-1">
                    <HugeiconsIcon
                      icon={
                        fileOps.viewMode === "starred"
                          ? StarIcon
                          : fileOps.viewMode === "trash"
                            ? Delete02Icon
                            : fileOps.viewMode === "shared"
                              ? UserGroupIcon
                              : LockIcon
                      }
                      size={20}
                      color="var(--accent-green-primary)"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="relative flex h-1 w-1"><span className="animate-ping absolute h-full w-full rounded-full bg-accent-green opacity-75" /><span className="relative h-1 w-1 rounded-full bg-accent-green" /></span>
                    <span className="text-[7px] text-accent-green font-medium">Encrypted</span>
                  </div>
                </div>
              </div>

              {fileOps.viewMode === "starred" ? (
                <>
                  <h3 className="text-[18px] font-semibold text-text-primary mb-2">No starred files</h3>
                  <p className="text-[13px] text-text-tertiary leading-relaxed mb-6">
                    Star important files from the context menu to find them quickly here.
                  </p>
                  <div className="flex items-center justify-center">
                    <button onClick={() => fileOps.setViewMode("own")} className="h-[38px] px-5 rounded-[10px] text-[13px] font-medium text-text-secondary border border-border-secondary hover:bg-cta-secondary-hover transition-colors cursor-pointer flex items-center gap-2">
                      Back to My Drive
                    </button>
                  </div>
                </>
              ) : fileOps.viewMode === "recent" ? (
                <>
                  <h3 className="text-[18px] font-semibold text-text-primary mb-2">No recent files</h3>
                  <p className="text-[13px] text-text-tertiary leading-relaxed mb-6">
                    Files you upload or interact with will appear here.
                  </p>
                  <div className="flex items-center justify-center">
                    <button onClick={() => fileOps.setViewMode("own")} className="h-[38px] px-5 rounded-[10px] text-[13px] font-medium text-text-secondary border border-border-secondary hover:bg-cta-secondary-hover transition-colors cursor-pointer flex items-center gap-2">
                      Back to My Drive
                    </button>
                  </div>
                </>
              ) : fileOps.viewMode === "trash" ? (
                <>
                  <h3 className="text-[18px] font-semibold text-text-primary mb-2">Trash is empty</h3>
                  <p className="text-[13px] text-text-tertiary leading-relaxed mb-6">
                    Files and folders you delete land here. Restore them from the context menu, or empty the trash to free up space.
                  </p>
                  <div className="flex items-center justify-center">
                    <button
                      onClick={() => fileOps.setViewMode("own")}
                      className="h-[38px] px-5 rounded-[10px] text-[13px] font-medium text-text-secondary border border-border-secondary hover:bg-cta-secondary-hover transition-colors cursor-pointer flex items-center gap-2"
                    >
                      Back to My Drive
                    </button>
                  </div>
                </>
              ) : fileOps.viewMode === "shared" ? (
                <>
                  <h3 className="text-[18px] font-semibold text-text-primary mb-2">Nothing shared with you yet</h3>
                  <p className="text-[13px] text-text-tertiary leading-relaxed mb-6">
                    When someone shares a file with your email, it shows up here, decrypted in your
                    browser using your private key. Ask a collaborator to send you something.
                  </p>
                  <div className="flex items-center justify-center">
                    <button
                      onClick={() => fileOps.setViewMode("own")}
                      className="h-[38px] px-5 rounded-[10px] text-[13px] font-medium text-text-secondary border border-border-secondary hover:bg-cta-secondary-hover transition-colors cursor-pointer flex items-center gap-2"
                    >
                      Back to My Drive
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-[18px] font-semibold text-text-primary mb-2">Your vault is empty</h3>
                  <p className="text-[13px] text-text-tertiary leading-relaxed mb-6">
                    Upload your first file or create a folder. Everything is end-to-end encrypted before it leaves your browser.
                  </p>
                  <div className="flex items-center justify-center gap-2.5">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="h-[38px] px-5 rounded-[10px] text-[13px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] flex items-center gap-2"
                    >
                      <HugeiconsIcon icon={Upload04Icon} size={15} /> Upload files
                    </button>
                    <button
                      onClick={() => setNewFolderOpen(true)}
                      className="h-[38px] px-5 rounded-[10px] text-[13px] font-medium text-text-secondary border border-border-secondary hover:bg-cta-secondary-hover transition-colors cursor-pointer flex items-center gap-2"
                    >
                      <HugeiconsIcon icon={FolderAddIcon} size={15} /> New folder
                    </button>
                  </div>
                  <p className="text-[11px] text-text-disabled mt-4">
                    Drag and drop files anywhere on this page
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Loading skeleton — Skiff-style slow pulse */}
        {(fileOps.loading || !fileOps.initialized) && (
          <div className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center h-[56px] px-4 rounded-xl border border-border-tertiary" style={{ animationDelay: `${i * 0.15}s` }}>
                <div className="skeleton w-[18px] h-[18px] rounded-[4px] mr-4" style={{ animationDelay: `${i * 0.15}s` }} />
                <div className="skeleton w-8 h-8 rounded-lg mr-3" style={{ animationDelay: `${i * 0.15 + 0.05}s` }} />
                <div className="flex-1 flex items-center gap-3">
                  <div className="skeleton h-3 rounded-md" style={{ width: `${100 + i * 15}px`, animationDelay: `${i * 0.15 + 0.1}s` }} />
                </div>
                <div className="skeleton h-[20px] w-10 rounded-md ml-4" style={{ animationDelay: `${i * 0.15 + 0.15}s` }} />
                <div className="skeleton h-3 w-12 rounded-md ml-6" style={{ animationDelay: `${i * 0.15 + 0.2}s` }} />
              </div>
            ))}
          </div>
        )}

        {displayFiles.map((file) => {
          const isSelected = selected.has(file.id);
          return (
            <div
              key={file.id}
              draggable={fileOps.viewMode === "own" && !file.uploading && fileOps.callerPermission !== "viewer"}
              onDragStart={(e) => {
                setDragFileId(file.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", file.id);
              }}
              onDragEnd={() => {
                setDragFileId(null);
                setDropTargetId(null);
              }}
              onDragOver={(e) => {
                if (!dragFileId || !file.isFolder || dragFileId === file.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropTargetId(file.id);
              }}
              onDragLeave={() => {
                if (dropTargetId === file.id) setDropTargetId(null);
              }}
              onDrop={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                setDropTargetId(null);
                if (!dragFileId || !file.isFolder || dragFileId === file.id) return;
                const source = fileOps.files.find((f) => f.id === dragFileId);
                const dest = fileOps.files.find((f) => f.id === file.id);
                if (!source || !dest) return;
                setDragFileId(null);
                await fileOps.moveFile(source, dest.id, dest.publicHierarchicalKey);
              }}
              onClick={() => {
                if (file.isFolder && fileOps.viewMode !== "trash") {
                  fileOps.navigateToFolder(file.id, file.name);
                } else if (!file.isFolder && !file.uploading && fileOps.viewMode !== "trash") {
                  setPreviewFileId(file.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, fileId: file.id, isFolder: !!file.isFolder });
              }}
              className={`group flex items-center h-[64px] md:h-[56px] px-4 rounded-xl border cursor-pointer transition-colors mb-1.5 ${
                dropTargetId === file.id
                  ? "border-accent-green bg-accent-green/5"
                  : dragFileId === file.id
                    ? "opacity-40 border-border-tertiary"
                    : isSelected
                      ? "border-accent-green/20 bg-bg-overlay-tertiary"
                      : "border-border-tertiary hover:border-border-secondary hover:bg-bg-overlay-tertiary"
              }`}
            >
              {/* Checkbox (hidden on mobile) */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleSelect(file.id); }}
                className={`hidden md:flex w-[18px] h-[18px] rounded-[4px] border items-center justify-center mr-4 cursor-pointer transition-all shrink-0 ${
                  isSelected ? "border-accent-green bg-accent-green" : "border-border-primary opacity-0 group-hover:opacity-100 hover:border-border-hover"
                }`}
              >
                {isSelected && <HugeiconsIcon icon={Tick01Icon} size={12} color="white" />}
              </button>

              {/* Icon + name + badges */}
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {file.uploading ? (
                  <div className="flex h-8 w-8 items-center justify-center shrink-0">
                    <svg width="28" height="28" viewBox="0 0 28 28" style={{ animation: "spin 0.75s linear infinite" }}>
                      <circle cx="14" cy="14" r="11" fill="none" stroke="var(--bg-overlay-tertiary)" strokeWidth="2" />
                      <circle
                        cx="14" cy="14" r="11" fill="none"
                        stroke="var(--accent-green-primary)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 11 * 0.3} ${2 * Math.PI * 11 * 0.7}`}
                        style={{ transformOrigin: "center", transform: "rotate(-90deg)" }}
                      />
                    </svg>
                  </div>
                ) : (
                  <FileIcon type={file.type} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[13px] truncate ${file.uploading ? "text-text-tertiary" : "text-text-primary"}`}>{file.name}</span>
                    {fileOps.files.find((f) => f.id === file.id)?.isStarred && (
                      <HugeiconsIcon icon={StarIcon} size={12} color="var(--accent-yellow-primary)" className="shrink-0" />
                    )}
                  </div>
                  {file.uploading && (
                    <span className="text-[10px] text-accent-green block mt-0.5">{fileOps.uploadStep || "Processing..."}</span>
                  )}
                </div>
              </div>

              {/* Metadata */}
              <div className="hidden md:flex items-center gap-[46px] relative">
                <div className="w-[100px] flex justify-end">
                  {file.fileType !== "FOLDER" && (
                    <span className="flex h-5 items-center justify-center rounded bg-bg-field px-1.5 py-0.5 text-[11px] font-mono uppercase text-text-disabled">
                      {file.fileType}
                    </span>
                  )}
                </div>
                <div className="w-[100px] flex justify-end">
                  <span className="text-[12px] text-text-disabled">{file.size}</span>
                </div>
                <div className="w-[110px] justify-end hidden md:flex">
                  <CollaboratorStack collaborators={file.collaborators} />
                </div>
                <div className="w-[100px] justify-end hidden lg:flex group-hover:opacity-0 transition-opacity">
                  <span className="text-[12px] text-text-disabled">{file.modified}</span>
                </div>

                {/* Hover actions */}
                <div className="absolute right-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const full = fileOps.files.find((f) => f.id === file.id);
                      if (full) fileOps.toggleStar(full.id, !full.isStarred);
                    }}
                    className={`p-1.5 rounded-md hover:bg-cta-nav-hover transition-colors cursor-pointer ${
                      fileOps.files.find((f) => f.id === file.id)?.isStarred
                        ? "text-accent-yellow"
                        : "text-icon-tertiary hover:text-accent-yellow"
                    }`}
                  >
                    <HugeiconsIcon icon={StarIcon} size={15} />
                  </button>
                  {fileOps.viewMode === "own" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const full = fileOps.files.find((f) => f.id === file.id);
                        if (full) setShareTarget(full);
                      }}
                      className="p-1.5 rounded-md text-icon-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer"
                    >
                      <HugeiconsIcon icon={Share01Icon} size={15} />
                    </button>
                  )}
                  <button onClick={(e) => {
                    e.stopPropagation();
                    if (contextMenu?.fileId === file.id) {
                      setContextMenu(null);
                    } else {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setContextMenu({ x: rect.right - 180, y: rect.bottom + 4, fileId: file.id, isFolder: !!file.isFolder });
                    }
                  }} className="p-1.5 rounded-md text-icon-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer">
                    <HugeiconsIcon icon={MoreHorizontalIcon} size={15} />
                  </button>
                </div>
              </div>
              {/* Mobile three-dot menu (touch devices have no hover) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setContextMenu({ x: rect.right - 180, y: rect.bottom + 4, fileId: file.id, isFolder: !!file.isFolder });
                }}
                className="md:hidden p-1.5 rounded-md text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer shrink-0 ml-2"
              >
                <HugeiconsIcon icon={MoreHorizontalIcon} size={15} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Context menu: bottom sheet on mobile, floating dropdown on desktop */}
      {contextMenu && createPortal(
        <div className="fixed inset-0 z-[9999]" onClick={() => setContextMenu(null)}>
          {/* Backdrop (mobile only) */}
          <div className="absolute inset-0 bg-black/40 md:bg-transparent" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="fixed md:absolute w-full md:w-[180px] bottom-0 md:bottom-auto left-0 md:left-auto rounded-t-2xl md:rounded-[8px] bg-bg-l3 border-t md:border border-border-primary overflow-hidden py-2 md:py-1 animate-fade-in"
            style={{
              top: undefined,
              ...(typeof window !== "undefined" && window.innerWidth >= 768
                ? {
                    position: "fixed" as const,
                    top: Math.min(contextMenu.y, window.innerHeight - 300),
                    left: Math.min(contextMenu.x, window.innerWidth - 200),
                    bottom: "auto",
                    width: 180,
                    borderRadius: 8,
                  }
                : {}),
              boxShadow: "var(--shadow-l2)",
            }}
          >
            {/* Bottom sheet handle (mobile only) */}
            <div className="flex justify-center pb-2 md:hidden">
              <div className="w-10 h-1 rounded-full bg-border-secondary" />
            </div>
          {fileOps.viewMode !== "trash" && (
            <>
              <button
                onClick={() => {
                  if (!contextMenu) return;
                  const full = fileOps.files.find((f) => f.id === contextMenu.fileId);
                  if (full?.isFolder) {
                    fileOps.navigateToFolder(full.id, full.name);
                  } else if (full) {
                    setPreviewFileId(full.id);
                  }
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={FolderAddIcon} size={14} color="var(--icon-tertiary)" /> Open
              </button>
              {fileOps.callerPermission !== "viewer" && (
                <button
                  onClick={() => {
                    if (!contextMenu) return;
                    const full = fileOps.files.find((f) => f.id === contextMenu.fileId);
                    if (full) {
                      setRenameTarget(full);
                      setRenameValue(full.name);
                      setRenameError(null);
                    }
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
                >
                  <HugeiconsIcon icon={Edit02Icon} size={14} color="var(--icon-tertiary)" /> Rename
                </button>
              )}
              <button
                onClick={() => {
                  if (!contextMenu) return;
                  const full = fileOps.files.find((f) => f.id === contextMenu.fileId);
                  if (full) fileOps.toggleStar(full.id, !full.isStarred);
                  setContextMenu(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={StarIcon} size={14} color="var(--icon-tertiary)" />
                {(() => {
                  const f = fileOps.files.find((f) => f.id === contextMenu?.fileId);
                  return f?.isStarred ? "Unstar" : "Star";
                })()}
              </button>
            </>
          )}
          {fileOps.viewMode === "trash" && (
            <button
              onClick={async () => {
                if (!contextMenu) return;
                const fileId = contextMenu.fileId;
                setContextMenu(null);
                await fileOps.restoreItem(fileId);
              }}
              className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} color="var(--icon-tertiary)" /> Restore
            </button>
          )}
          {fileOps.viewMode === "own" && (
            <button
              onClick={() => {
                if (contextMenu) {
                  const full = fileOps.files.find((f) => f.id === contextMenu.fileId);
                  if (full) setShareTarget(full);
                }
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Share01Icon} size={14} color="var(--icon-tertiary)" /> Share
            </button>
          )}
          {fileOps.viewMode !== "trash" && !contextMenu?.isFolder && (
            <button onClick={() => { if (contextMenu) { fileOps.downloadFile(contextMenu.fileId); setContextMenu(null); } }} className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer">
              <HugeiconsIcon icon={Download04Icon} size={14} color="var(--icon-tertiary)" /> Download
            </button>
          )}
          {fileOps.viewMode !== "trash" && (
            <>
              {fileOps.callerPermission !== "viewer" && (
                <button
                  onClick={() => {
                    if (!contextMenu) return;
                    const full = fileOps.files.find((f) => f.id === contextMenu.fileId);
                    if (full) setMoveTarget(full);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
                >
                  <HugeiconsIcon icon={Move01Icon} size={14} color="var(--icon-tertiary)" /> Move to
                </button>
              )}
              <button className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer">
                <HugeiconsIcon icon={InformationCircleIcon} size={14} color="var(--icon-tertiary)" /> Details
              </button>
            </>
          )}
          <div className="h-px bg-border-tertiary my-1" />
          {fileOps.viewMode === "trash" ? (
            <button
              onClick={() => {
                if (!contextMenu) return;
                const full = fileOps.files.find((f) => f.id === contextMenu.fileId);
                if (full) setPurgeTarget(full);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-accent-red hover:bg-bg-cell-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} /> Delete forever
            </button>
          ) : fileOps.viewMode === "shared" ? (
            <button
              onClick={async () => {
                if (!contextMenu) return;
                const fileId = contextMenu.fileId;
                setContextMenu(null);
                await fileOps.leaveShare(fileId);
              }}
              className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-accent-red hover:bg-bg-cell-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} /> Remove from shared
            </button>
          ) : (
            <button
              onClick={() => {
                if (contextMenu) {
                  fileOps.deleteItem(contextMenu.fileId);
                  setContextMenu(null);
                }
              }}
              className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-accent-red hover:bg-bg-cell-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} /> Trash
            </button>
          )}
        </div>
        </div>,
        document.body
      )}

      <NewFolderModal open={newFolderOpen} onClose={() => setNewFolderOpen(false)} onCreate={(name) => fileOps.createFolder(name, fileOps.currentFolder)} />
      <RenameModal
        file={renameTarget}
        value={renameValue}
        onChange={setRenameValue}
        busy={renameBusy}
        error={renameError}
        onClose={() => {
          setRenameTarget(null);
          setRenameError(null);
          setRenameBusy(false);
        }}
        onSubmit={async () => {
          if (!renameTarget) return;
          setRenameBusy(true);
          setRenameError(null);
          const res = await fileOps.renameFile(renameTarget, renameValue);
          setRenameBusy(false);
          if (res.ok) {
            setRenameTarget(null);
          } else {
            setRenameError(res.error);
          }
        }}
      />
      <ConfirmDialog
        open={emptyTrashOpen}
        title="Empty trash?"
        description="Every file and folder currently in your trash will be permanently deleted. This can't be undone."
        confirmLabel="Empty trash"
        destructive
        busy={emptyTrashBusy}
        busyLabel="Emptying…"
        onConfirm={async () => {
          setEmptyTrashBusy(true);
          await fileOps.emptyTrash();
          setEmptyTrashBusy(false);
          setEmptyTrashOpen(false);
        }}
        onCancel={() => !emptyTrashBusy && setEmptyTrashOpen(false)}
      />
      <ConfirmDialog
        open={!!purgeTarget}
        title={`Delete "${purgeTarget?.name ?? ""}" forever?`}
        description={
          purgeTarget?.isFolder
            ? "This folder and every file inside it will be permanently deleted. This can't be undone."
            : "This file will be permanently deleted. This can't be undone."
        }
        confirmLabel="Delete forever"
        destructive
        busy={purgeBusy}
        busyLabel="Deleting…"
        onConfirm={async () => {
          if (!purgeTarget) return;
          setPurgeBusy(true);
          await fileOps.purgeItem(purgeTarget.id);
          setPurgeBusy(false);
          setPurgeTarget(null);
        }}
        onCancel={() => !purgeBusy && setPurgeTarget(null)}
      />
      <FilePreview
        fileId={previewFileId}
        fileIds={displayFiles.filter((f) => !f.isFolder && !f.uploading).map((f) => f.id)}
        onClose={() => setPreviewFileId(null)}
        onNavigate={setPreviewFileId}
      />
      <MoveModal file={moveTarget} onClose={() => setMoveTarget(null)} />
      <ShareModal file={shareTarget} onClose={() => setShareTarget(null)} />
      <MembersModal open={membersOpen} onClose={() => setMembersOpen(false)} />
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onAction={(action) => {
          switch (action) {
            case "a1": fileInputRef.current?.click(); break;
            case "a2": setNewFolderOpen(true); break;
            case "a3": {
              const first = fileOps.files[0];
              if (first) setShareTarget(first);
              break;
            }
            case "a5": fileOps.setViewMode("starred"); break;
            case "a6": fileOps.setViewMode("trash"); break;
          }
        }}
        onOpenFile={(fileId, isFolder) => {
          if (isFolder) {
            const f = fileOps.files.find((x) => x.id === fileId);
            if (f) {
              fileOps.navigateToFolder(f.id, f.name);
            } else {
              fileOps.navigateToFolder(fileId, "Folder");
            }
          } else {
            setPreviewFileId(fileId);
          }
        }}
      />

      {/* Mobile FAB for upload + new folder */}
      {fileOps.viewMode !== "trash" && fileOps.callerPermission !== "viewer" && (fileOps.viewMode === "own" || fileOps.currentFolder) && (
        <div className="fixed bottom-[76px] right-4 z-20 flex flex-col gap-2 md:hidden">
          <button
            onClick={() => setNewFolderOpen(true)}
            className="w-[48px] h-[48px] rounded-full bg-bg-l3 border border-border-secondary flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
            style={{ boxShadow: "var(--shadow-l2)" }}
          >
            <HugeiconsIcon icon={FolderAddIcon} size={20} color="var(--icon-secondary)" />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-[48px] h-[48px] rounded-full bg-accent-green flex items-center justify-center cursor-pointer active:scale-95 transition-transform text-white"
            style={{ boxShadow: "var(--shadow-l2)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
