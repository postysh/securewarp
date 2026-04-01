"use client";

import { useState, useRef, useCallback } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import ArrowUp01Icon from "@hugeicons/core-free-icons/ArrowUp01Icon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import Share01Icon from "@hugeicons/core-free-icons/Share01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import FolderAddIcon from "@hugeicons/core-free-icons/FolderAddIcon";
import Upload04Icon from "@hugeicons/core-free-icons/Upload04Icon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import SidebarLeft01Icon from "@hugeicons/core-free-icons/SidebarLeft01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import { NotificationBell } from "./notifications";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import { FileIcon, type FileKind } from "./file-icon";
import { Tooltip } from "./tooltip";
import { Facepile } from "./facepile";
import { NewFolderModal } from "./new-folder-modal";
import { ShareModal } from "./share-modal";
import { MembersModal } from "./members-modal";

interface FileItem {
  id: string;
  name: string;
  type: FileKind;
  fileType: string;
  size: string;
  modified: string;
  shared?: boolean;
}

const mockFiles: FileItem[] = [
  { id: "1", name: "Q1 overview", type: "folder", fileType: "FOLDER", size: "", modified: "Mar 28, 2026" },
  { id: "2", name: "Milestones", type: "folder", fileType: "FOLDER", size: "", modified: "Mar 25, 2026" },
  { id: "3", name: "Team review", type: "document", fileType: "DOCX", size: "856 KB", modified: "Mar 30, 2026", shared: true },
  { id: "4", name: "BG-02.png", type: "image", fileType: "PNG", size: "1.8 MB", modified: "Mar 27, 2026" },
  { id: "5", name: "FetchTable.py", type: "code", fileType: "PY", size: "4 KB", modified: "Mar 26, 2026" },
  { id: "6", name: "CapTable.xls", type: "spreadsheet", fileType: "XLS", size: "2.4 MB", modified: "Mar 29, 2026", shared: true },
  { id: "7", name: "Blonded", type: "audio", fileType: "MP3", size: "48 MB", modified: "Mar 24, 2026" },
  { id: "8", name: "daily-finances", type: "archive", fileType: "ZIP", size: "15 MB", modified: "Mar 21, 2026" },
  { id: "9", name: "Town hall", type: "page", fileType: "PAGE", size: "12 KB", modified: "Mar 23, 2026" },
  { id: "10", name: "Architecture Diagram", type: "pdf", fileType: "PDF", size: "5.2 MB", modified: "Mar 20, 2026", shared: true },
  { id: "11", name: "Demo Recording", type: "video", fileType: "MP4", size: "124 MB", modified: "Mar 22, 2026" },
  { id: "12", name: "Pitch Deck", type: "presentation", fileType: "PPTX", size: "5.2 MB", modified: "Mar 19, 2026" },
];

type SortField = "name" | "type" | "size" | "modified";

export function FileBrowser({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    // Files would be handled here: e.dataTransfer.files
  }, []);

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
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={() => { /* handle files */ }} />

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
      <div className="relative flex items-center justify-between px-5 h-[52px] shrink-0">
        {/* Left: sidebar toggle + breadcrumb */}
        <div className="flex items-center gap-1.5 text-[13px] shrink-0 z-10">
          <button onClick={onToggleSidebar} className="p-1.5 rounded-md text-icon-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer mr-1">
            <HugeiconsIcon icon={SidebarLeft01Icon} size={16} />
          </button>
          <span className="text-text-secondary hover:text-text-primary cursor-pointer transition-colors">My Drive</span>
          <span className="text-text-disabled">/</span>
          <span className="text-text-secondary hover:text-text-primary cursor-pointer transition-colors">General</span>
          <span className="text-text-disabled">/</span>
          <span className="text-text-primary font-medium">Q1 overview</span>
        </div>

        {/* Center: search (absolute so it stays centered regardless of left/right width) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex h-8 w-full max-w-[360px] items-center rounded-lg bg-bg-overlay-tertiary px-3 gap-2 text-text-disabled text-[13px] cursor-text pointer-events-auto">
            <HugeiconsIcon icon={Search01Icon} size={15} />
            <span>Search files...</span>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 shrink-0 z-10">
          {selected.size > 0 && (
            <div className="flex items-center gap-1 mr-2 text-icon-secondary">
              <button className="p-1.5 rounded-md hover:bg-cta-nav-hover transition-colors cursor-pointer"><HugeiconsIcon icon={Download04Icon} size={16} /></button>
              <button className="p-1.5 rounded-md hover:bg-cta-nav-hover transition-colors cursor-pointer"><HugeiconsIcon icon={Share01Icon} size={16} /></button>
              <button className="p-1.5 rounded-md hover:bg-cta-nav-hover transition-colors cursor-pointer"><HugeiconsIcon icon={Delete02Icon} size={16} /></button>
            </div>
          )}
          {/* Facepile */}
          <Facepile onClick={() => setMembersOpen(true)} onOverflowClick={() => setMembersOpen(true)} />
          <button onClick={() => setShareOpen(true)} className="flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer">
            <HugeiconsIcon icon={UserAdd01Icon} size={14} />
            Invite
          </button>
          <button onClick={() => setNewFolderOpen(true)} className="flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer">
            <HugeiconsIcon icon={FolderAddIcon} size={14} />
            New folder
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] text-[12px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-opacity cursor-pointer">
            <HugeiconsIcon icon={Upload04Icon} size={14} />
            Upload
          </button>
          <NotificationBell />
        </div>
      </div>

      {/* E2E banner */}
      <div className="mx-5 mt-3 mb-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-green-bg text-accent-green text-[12px] font-medium">
        <HugeiconsIcon icon={LockIcon} size={14} />
        End-to-end encrypted. Only you and people you share with can see these files.
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {/* Table header */}
        <div className="flex items-center h-[40px] px-5 box-border select-none">
          <div className="flex items-center gap-7 w-[80px] min-w-[80px] border-r border-border-secondary pr-4">
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
            <div className="w-[100px] justify-end hidden lg:flex">
              <button onClick={() => toggleSort("modified")} className="flex items-center gap-1 text-[11px] font-mono uppercase text-text-disabled hover:text-text-tertiary cursor-pointer transition-colors">
                Modified <SortArrow field="modified" />
              </button>
            </div>
          </div>
        </div>

        {/* Rows */}
        {mockFiles.map((file) => (
          <div
            key={file.id}
            onClick={() => toggleSelect(file.id)}
            className={`group flex items-center h-[56px] px-5 border-b border-border-tertiary cursor-pointer transition-colors ${
              selected.has(file.id) ? "bg-bg-overlay-tertiary" : "hover:bg-bg-overlay-tertiary"
            }`}
          >
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <FileIcon type={file.type} />
              <span className="text-[14px] text-text-primary truncate">{file.name}</span>
            </div>

            <div className="flex items-center gap-[46px] relative">
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
              <div className="w-[100px] justify-end hidden lg:flex group-hover:opacity-0 transition-opacity">
                <span className="text-[12px] text-text-disabled">{file.modified}</span>
              </div>
              <div className="absolute right-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none group-hover:pointer-events-auto">
                <button onClick={(e) => e.stopPropagation()} className="p-1.5 rounded-md text-icon-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer">
                  <HugeiconsIcon icon={Share01Icon} size={16} />
                </button>
                <button onClick={(e) => e.stopPropagation()} className="p-1.5 rounded-md text-icon-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer">
                  <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <NewFolderModal open={newFolderOpen} onClose={() => setNewFolderOpen(false)} />
      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} />
      <MembersModal open={membersOpen} onClose={() => setMembersOpen(false)} />
    </div>
  );
}
