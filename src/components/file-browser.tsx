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
import PinIcon from "@hugeicons/core-free-icons/PinIcon";
import Move01Icon from "@hugeicons/core-free-icons/Move01Icon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
import GridViewIcon from "@hugeicons/core-free-icons/GridViewIcon";
import LeftToRightListBulletIcon from "@hugeicons/core-free-icons/LeftToRightListBulletIcon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import MinusSignIcon from "@hugeicons/core-free-icons/MinusSignIcon";
import { NotificationBell } from "./notifications";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import { FileIcon, type FileKind } from "./file-icon";
import { Tooltip } from "./tooltip";
import { Facepile, type FacepileUser } from "./facepile";
import dynamic from "next/dynamic";
const CommandPalette = dynamic(() => import("./command-palette").then((m) => ({ default: m.CommandPalette })), { ssr: false });
const NewFolderModal = dynamic(() => import("./new-folder-modal").then((m) => ({ default: m.NewFolderModal })), { ssr: false });
const ShareModal = dynamic(() => import("./share-modal").then((m) => ({ default: m.ShareModal })), { ssr: false });
const RenameModal = dynamic(() => import("./rename-modal").then((m) => ({ default: m.RenameModal })), { ssr: false });
const MoveModal = dynamic(() => import("./move-modal").then((m) => ({ default: m.MoveModal })), { ssr: false });
const FilePreview = dynamic(() => import("./file-preview").then((m) => ({ default: m.FilePreview })), { ssr: false });
const StorageQuotaModal = dynamic(() => import("./storage-quota-modal").then((m) => ({ default: m.StorageQuotaModal })), { ssr: false });
const VersionHistoryModal = dynamic(() => import("./version-history-modal").then((m) => ({ default: m.VersionHistoryModal })), { ssr: false });
const UploadPanel = dynamic(() => import("./upload-panel").then((m) => ({ default: m.UploadPanel })), { ssr: false });
import { ConfirmDialog } from "./confirm-dialog";
import { WorkspaceSettings } from "./workspace-settings";
import { WorkspaceInviteModal } from "./workspace-invite-modal";
import { WorkspaceActivityPage } from "./workspace-activity-modal";
import { FileDetailsModal } from "./file-details-modal";
const MembersModal = dynamic(() => import("./members-modal").then((m) => ({ default: m.MembersModal })), { ssr: false });
import { useFilesContext, type DecryptedFile, type FileCollaboratorPreview } from "@/hooks/use-files";
import { initialsFromEmail, colorForEmail } from "@/lib/avatar";
import { userLabel, userInitials, userColor } from "@/lib/display";
import { useUserKeys } from "@/hooks/use-user-keys";
import { useNewFiles } from "@/hooks/use-new-files";
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

// Thumbnail cache for grid view image previews
const thumbnailCache = new Map<string, string>();

function GridThumbnail({ fileId, kind, previewFile }: { fileId: string; kind: FileKind; previewFile: (id: string) => Promise<{ ok: true; blobUrl: string; name: string; type: string } | { ok: false; error: string }> }) {
  const [src, setSrc] = useState<string | null>(() => thumbnailCache.get(fileId) ?? null);
  const [failed, setFailed] = useState(false);
  const attempted = useRef(false);
  const imgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (kind !== "image" || src || failed || attempted.current) return;
    const el = imgRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      obs.disconnect();
      attempted.current = true;
      (async () => {
        try {
          const result = await previewFile(fileId);
          if (result.ok) {
            thumbnailCache.set(fileId, result.blobUrl);
            setSrc(result.blobUrl);
          } else {
            setFailed(true);
          }
        } catch {
          setFailed(true);
        }
      })();
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [fileId, kind, src, failed, previewFile]);

  if (kind !== "image" || failed || !src) {
    return <div ref={imgRef} className="flex items-center justify-center"><FileIcon type={kind} size={28} /></div>;
  }

  return (
    <div ref={imgRef} className="w-full h-[60px] rounded-lg overflow-hidden bg-bg-overlay-tertiary mx-auto" style={{ maxWidth: "85%" }}>
      <img src={src} alt="" className="w-full h-full object-cover" draggable={false} />
    </div>
  );
}

function roleLabel(c: FileCollaboratorPreview): string {
  if (c.isOwner) return "Owner";
  if (c.permissionLevel === "viewer") return "Viewer";
  return "Editor";
}

function CollaboratorAvatar({ c, size = 24 }: { c: FileCollaboratorPreview; size?: number }) {
  const textSize = size >= 28 ? "10px" : "9px";
  const label = userLabel(c);
  const hasName = Boolean(c.displayName?.trim());
  const content = (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12px] text-text-primary font-medium truncate">{label}</span>
      {hasName && c.email && (
        <span className="text-[11px] text-text-tertiary truncate">{c.email}</span>
      )}
      <span className="text-[11px] text-text-disabled">{roleLabel(c)}</span>
    </div>
  );
  return (
    <Tooltip label={label} content={content} side="bottom">
      <div
        className="rounded-full border-2 border-bg-main flex items-center justify-center font-bold text-white"
        style={{
          width: size,
          height: size,
          backgroundColor: userColor(c),
          fontSize: textSize,
        }}
      >
        {userInitials(c)}
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
          <span className="text-[12px] text-text-primary truncate">{userLabel(c)}</span>
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
  const newFiles = useNewFiles();
  const fileOps = useFilesContext();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>(() => {
    if (typeof window === "undefined") return "name";
    return (localStorage.getItem("securewarp_sort_field") as SortField) || "name";
  });
  const [sortAsc, setSortAsc] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("securewarp_sort_asc") !== "false";
  });
  const [layout, setLayout] = useState<"list" | "grid">(() => {
    if (typeof window === "undefined") return "list";
    return (localStorage.getItem("securewarp_layout") as "list" | "grid") || "list";
  });
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<DecryptedFile | null>(null);
  const [versionHistoryTarget, setVersionHistoryTarget] = useState<DecryptedFile | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragFileId, setDragFileId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fileId: string | null; isFolder: boolean } | null>(null);
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);
  const [emptyTrashBusy, setEmptyTrashBusy] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<DecryptedFile | null>(null);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [quotaModalOpen, setQuotaModalOpen] = useState(false);

  // Intercept quota/storage errors and open the dedicated modal
  // instead of showing the generic inline banner.
  useEffect(() => {
    if (
      fileOps.error &&
      (fileOps.error.toLowerCase().includes("quota") ||
        fileOps.error.toLowerCase().includes("storage"))
    ) {
      setQuotaModalOpen(true);
      fileOps.clearError();
    }
  }, [fileOps.error, fileOps.clearError]);
  const [moveTarget, setMoveTarget] = useState<DecryptedFile | null>(null);
  // Rubber band drag selection
  const [rubberBand, setRubberBand] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [userLabels, setUserLabels] = useState<{ id: string; name: string; color: string }[]>([]);
  const [filterLabel, setFilterLabel] = useState<{ id: string; name: string; color: string } | null>(null);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [workspaceInviteOpen, setWorkspaceInviteOpen] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState<FacepileUser[]>([]);
  const [wsDefaultRole, setWsDefaultRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [showActivity, setShowActivity] = useState(false);
  const [detailsTarget, setDetailsTarget] = useState<DecryptedFile | null>(null);
  const [wsOwnerId, setWsOwnerId] = useState<string | undefined>(undefined);
  const [renameTarget, setRenameTarget] = useState<DecryptedFile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Track whether the initial mount restoration has completed so the
  // view-state writer below doesn't overwrite saved state with the
  // default "My Drive root" on first render.
  const hasRestoredViewRef = useRef(false);

  // Load files on mount and when keys become available. Restores the
  // prior view (workspace / folder / special mode like starred) from
  // sessionStorage so a refresh keeps the user where they were.
  useEffect(() => {
    if (!keys) return;
    hasRestoredViewRef.current = false;
    (async () => {
      // Read both stored blobs up front. Active workspace is written
      // by workspace-switcher; view state is written below by the
      // writer effect whenever navigation changes.
      let savedWorkspace:
        | { id: string; rootFolderId: string; name: string; role?: string }
        | null = null;
      try {
        const raw = sessionStorage.getItem("securewarp_active_workspace");
        if (raw) savedWorkspace = JSON.parse(raw);
      } catch { /* */ }

      let savedView:
        | { viewMode?: string; currentFolder?: string | null; breadcrumb?: { id: string | null; name: string }[] }
        | null = null;
      try {
        const raw = sessionStorage.getItem("securewarp_view_state");
        if (raw) savedView = JSON.parse(raw);
      } catch { /* */ }

      try {
        if (savedWorkspace) {
          // Workspace-scoped restore. Land at the workspace root
          // first, then navigate deeper if the saved folder is below
          // the root.
          await fileOps.navigateToWorkspace(
            savedWorkspace.id,
            savedWorkspace.rootFolderId,
            savedWorkspace.name,
            savedWorkspace.role,
          );
          if (
            savedView?.currentFolder &&
            savedView.currentFolder !== savedWorkspace.rootFolderId &&
            savedView.breadcrumb &&
            savedView.breadcrumb.length > 0
          ) {
            await fileOps.fetchFiles(
              savedView.currentFolder,
              "own",
              savedView.breadcrumb,
            );
          }
        } else if (
          savedView?.viewMode &&
          savedView.viewMode !== "own"
        ) {
          // Special personal-drive view (starred / recent / trash / shared).
          await fileOps.fetchFiles(
            null,
            savedView.viewMode as "starred" | "recent" | "trash" | "shared",
            savedView.breadcrumb,
          );
        } else if (savedView?.currentFolder) {
          // Inside a personal-drive subfolder.
          await fileOps.fetchFiles(
            savedView.currentFolder,
            "own",
            savedView.breadcrumb,
          );
        } else {
          // Fresh session / no saved state — My Drive root.
          await fileOps.fetchFiles(null);
        }
      } finally {
        hasRestoredViewRef.current = true;
      }
    })();
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist the current view whenever it changes. Gated on
  // hasRestoredViewRef so the initial pre-restore state (default
  // "My Drive root") doesn't clobber a valid saved view.
  useEffect(() => {
    if (!keys || !hasRestoredViewRef.current) return;
    try {
      sessionStorage.setItem(
        "securewarp_view_state",
        JSON.stringify({
          viewMode: fileOps.viewMode,
          currentFolder: fileOps.currentFolder,
          breadcrumb: fileOps.breadcrumb,
        }),
      );
    } catch { /* quota / private mode — non-fatal */ }
  }, [keys, fileOps.viewMode, fileOps.currentFolder, fileOps.breadcrumb]);

  // Fetch workspace members for the Facepile
  const fetchWorkspaceInfo = useCallback(() => {
    if (!fileOps.activeWorkspace) { setWorkspaceMembers([]); setWsDefaultRole("editor"); return; }
    fetch(`/api/workspaces/members?workspaceId=${fileOps.activeWorkspace.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.members) {
          setWorkspaceMembers(d.members.map((m: { email: string; displayName?: string | null }) => ({
            initials: userInitials(m),
            name: userLabel(m),
            bg: userColor(m),
          })));
        }
      })
      .catch(() => {});
    fetch("/api/workspaces")
      .then((r) => r.json())
      .then((d) => {
        const ws = d.workspaces?.find((w: { id: string }) => w.id === fileOps.activeWorkspace?.id);
        if (ws?.defaultRole) setWsDefaultRole(ws.defaultRole);
        if (ws?.ownerId) setWsOwnerId(ws.ownerId);
      })
      .catch(() => {});
  }, [fileOps.activeWorkspace]);

  useEffect(() => { fetchWorkspaceInfo(); }, [fetchWorkspaceInfo]);

  useEffect(() => {
    const handler = () => { fetchWorkspaceInfo(); };
    window.addEventListener("securewarp-workspace-updated", handler);
    const activityHandler = () => { setShowActivity(true); };
    const hideActivityHandler = () => { setShowActivity(false); };
    window.addEventListener("securewarp-show-activity", activityHandler);
    window.addEventListener("securewarp-hide-activity", hideActivityHandler);
    return () => {
      window.removeEventListener("securewarp-workspace-updated", handler);
      window.removeEventListener("securewarp-show-activity", activityHandler);
      window.removeEventListener("securewarp-hide-activity", hideActivityHandler);
    };
  }, [fetchWorkspaceInfo]);

  // Clear activity page when workspace changes
  useEffect(() => {
    setShowActivity(false);
  }, [fileOps.activeWorkspace]);

  // Close context menu and clear label filter when navigating
  useEffect(() => {
    setContextMenu(null);
    setFilterLabel(null);
  }, [fileOps.viewMode, fileOps.currentFolder]);


  // Fetch pinned IDs on mount
  useEffect(() => {
    fetch("/api/pins").then((r) => r.json()).then((d) => {
      if (d.pins) setPinnedIds(new Set(d.pins.map((p: { file_id: string }) => p.file_id)));
    }).catch(() => {});
  }, []);

  // Refetch labels every time context menu opens so newly created
  // labels from the sidebar appear immediately
  useEffect(() => {
    if (contextMenu) {
      fetch("/api/labels").then((r) => r.json()).then((d) => {
        if (d.labels) setUserLabels(d.labels);
      }).catch(() => {});
    }
  }, [contextMenu]);

  // Map decrypted files to display format
  // Filter by label if active
  const filteredFiles = filterLabel
    ? fileOps.files.filter((f) => f.fileLabels.some((l) => l.id === filterLabel.id))
    : fileOps.files;

  // Apply the column-header sort that was silently not-being-applied
  // before. Folders stay pinned above files regardless of sort — the
  // standard drive UI convention everyone expects. In-progress
  // uploading placeholders keep their top-of-list position too so
  // users aren't startled by their upload "jumping" as progress
  // updates would otherwise change sort ordering.
  const sortedFiles = [...filteredFiles].sort((a, b) => {
    if (a.uploading && !b.uploading) return -1;
    if (!a.uploading && b.uploading) return 1;
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    let cmp = 0;
    switch (sortField) {
      case "name":
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
        break;
      case "type": {
        const at = (a.isFolder ? "" : (a.name.split(".").pop() || "")).toLowerCase();
        const bt = (b.isFolder ? "" : (b.name.split(".").pop() || "")).toLowerCase();
        cmp = at.localeCompare(bt) || a.name.localeCompare(b.name);
        break;
      }
      case "size":
        cmp = (a.size || 0) - (b.size || 0);
        break;
      case "modified":
        cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        break;
    }
    return sortAsc ? cmp : -cmp;
  });

  const displayFiles = sortedFiles.map((f) => ({
    id: f.id,
    name: f.name,
    type: getFileKind(f.name, f.type),
    fileType: f.isFolder ? "FOLDER" : (f.name.split(".").pop()?.toUpperCase() || "FILE"),
    size: formatBytes(f.size),
    // Use updated_at so the Modified column actually reflects edits.
    // New-version uploads bump updated_at on files; creation time is
    // stored separately on each row in file_versions if we ever need
    // a dedicated "Created" column.
    modified: formatDate(f.updatedAt),
    isFolder: f.isFolder,
    uploading: f.uploading,
    uploadProgress: f.uploadProgress,
    collaborators: f.collaborators,
    ownerEmail: f.ownerEmail,
    ownerDisplayName: f.ownerDisplayName ?? null,
    // NEW badge flag — file was created in the last 24h and the
    // user hasn't interacted with it yet. Uploading placeholders
    // don't get a badge (they're obviously new already).
    isNew: !f.uploading && newFiles.isNew(f.id, f.createdAt),
  }));

  const selectAll = () => setSelected(new Set(displayFiles.map((f) => f.id)));
  const selectNone = () => setSelected(new Set());
  const allSelected = displayFiles.length > 0 && selected.size === displayFiles.length;
  const someSelected = selected.size > 0 && !allSelected;

  // Mobile bottom nav search trigger
  useEffect(() => {
    const openSearch = () => setCommandPaletteOpen(true);
    const previewFromPin = (e: Event) => {
      const fileId = (e as CustomEvent).detail;
      if (fileId) setPreviewFileId(fileId);
    };
    const filterByLabel = (e: Event) => {
      const label = (e as CustomEvent).detail;
      setFilterLabel(label ?? null);
    };
    window.addEventListener("securewarp-open-search", openSearch);
    window.addEventListener("securewarp-preview-file", previewFromPin);
    window.addEventListener("securewarp-filter-label", filterByLabel);
    return () => {
      window.removeEventListener("securewarp-open-search", openSearch);
      window.removeEventListener("securewarp-preview-file", previewFromPin);
      window.removeEventListener("securewarp-filter-label", filterByLabel);
    };
  }, []);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Track the focused file index for arrow key navigation
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // Reset focused index when files change
  useEffect(() => { setFocusedIndex(-1); }, [fileOps.currentFolder, fileOps.viewMode]);

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

      const files = displayFiles;

      // Cmd+A — select all
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        selectAll();
        return;
      }

      // Delete/Backspace — trash selected
      if ((e.key === "Delete" || e.key === "Backspace") && selected.size > 0) {
        e.preventDefault();
        const ids = [...selected];
        selectNone();
        (async () => {
          for (const id of ids) await fileOps.deleteItem(id);
        })();
        return;
      }

      // Escape — clear selection
      if (e.key === "Escape") {
        if (selected.size > 0) { selectNone(); setFocusedIndex(-1); return; }
        return;
      }

      // Arrow down — move focus down (list) or right (grid)
      if (e.key === "ArrowDown" || (layout === "grid" && e.key === "ArrowRight")) {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.min(prev + 1, files.length - 1);
          if (e.shiftKey) toggleSelect(files[next]?.id);
          else { selectNone(); if (files[next]) setSelected(new Set([files[next].id])); }
          return next;
        });
        return;
      }

      // Arrow up — move focus up (list) or left (grid)
      if (e.key === "ArrowUp" || (layout === "grid" && e.key === "ArrowLeft")) {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.max(prev - 1, 0);
          if (e.shiftKey) toggleSelect(files[next]?.id);
          else { selectNone(); if (files[next]) setSelected(new Set([files[next].id])); }
          return next;
        });
        return;
      }

      // Enter — open focused file/folder
      if (e.key === "Enter" && focusedIndex >= 0 && focusedIndex < files.length) {
        e.preventDefault();
        const file = files[focusedIndex];
        if (file.isFolder && fileOps.viewMode !== "trash") {
          fileOps.navigateToFolder(file.id, file.name);
        } else if (!file.isFolder && !file.uploading && fileOps.viewMode !== "trash") {
          setPreviewFileId(file.id);
        }
        return;
      }

      // Backspace without selection — navigate up (like going back)
      if (e.key === "Backspace" && selected.size === 0 && fileOps.breadcrumb.length > 1) {
        e.preventDefault();
        fileOps.navigateToBreadcrumb(fileOps.breadcrumb.length - 2);
        return;
      }

      // Space — toggle select on focused item
      if (e.key === " " && focusedIndex >= 0 && focusedIndex < files.length) {
        e.preventDefault();
        toggleSelect(files[focusedIndex].id);
        return;
      }

      // D — download focused/selected
      if (e.key === "d" && !e.metaKey && !e.ctrlKey) {
        if (selected.size > 0) {
          for (const id of selected) {
            const f = fileOps.files.find((x) => x.id === id);
            if (f && !f.isFolder) fileOps.downloadFile(id);
          }
        } else if (focusedIndex >= 0 && !files[focusedIndex]?.isFolder) {
          fileOps.downloadFile(files[focusedIndex].id);
        }
        return;
      }

      // I — open details on focused/selected
      if (e.key === "i" && !e.metaKey && !e.ctrlKey) {
        const targetId = selected.size === 1 ? [...selected][0] : (focusedIndex >= 0 ? files[focusedIndex]?.id : null);
        if (targetId) {
          const full = fileOps.files.find((f) => f.id === targetId);
          if (full) setDetailsTarget(full);
        }
        return;
      }

      // N — new folder
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && fileOps.callerPermission !== "viewer") {
        setNewFolderOpen(true);
        return;
      }

      // U — upload
      if (e.key === "u" && !e.metaKey && !e.ctrlKey && fileOps.callerPermission !== "viewer") {
        fileInputRef.current?.click();
        return;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selected, selectAll, selectNone, fileOps, displayFiles, focusedIndex, layout, toggleSelect]);
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
    if (fileOps.viewMode === "shared" || fileOps.viewMode === "trash" || fileOps.callerPermission === "viewer") return;
    // Ignore internal file-move drags (they set text/plain with a UUID).
    if (e.dataTransfer.types.includes("text/plain") && !e.dataTransfer.files.length) return;
    const files = e.dataTransfer.files;
    if (!files.length) return;
    for (const file of Array.from(files)) {
      await fileOps.uploadFile(file, fileOps.currentFolder);
    }
  }, [fileOps]);

  // toggleSelect moved above keyboard handler — see below

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      const next = !sortAsc;
      setSortAsc(next);
      localStorage.setItem("securewarp_sort_asc", String(next));
    } else {
      setSortField(field);
      setSortAsc(true);
      localStorage.setItem("securewarp_sort_field", field);
      localStorage.setItem("securewarp_sort_asc", "true");
    }
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
            {(showActivity || fileOps.breadcrumb.length > 1) && (
              <button
                onClick={() => {
                  if (showActivity) { setShowActivity(false); window.dispatchEvent(new Event("securewarp-hide-activity")); }
                  else fileOps.navigateToBreadcrumb(fileOps.breadcrumb.length - 2);
                }}
                className="p-1 rounded-md text-icon-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer shrink-0"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={16} />
              </button>
            )}
            <span className="text-text-primary font-medium truncate">
              {showActivity ? "Activity" : (fileOps.breadcrumb[fileOps.breadcrumb.length - 1]?.name ?? "My Drive")}
            </span>
          </div>
          {/* Desktop breadcrumb: full path */}
          <div className="hidden md:flex items-center gap-1.5">
          {showActivity ? (
            <>
              <button
                onClick={() => { setShowActivity(false); window.dispatchEvent(new Event("securewarp-hide-activity")); }}
                className="text-text-secondary hover:text-text-primary cursor-pointer transition-colors bg-transparent border-none p-0 text-[13px]"
              >
                {fileOps.activeWorkspace?.name ?? "Workspace"}
              </button>
              <span className="text-text-disabled">/</span>
              <span className="text-text-primary font-medium">Activity</span>
            </>
          ) : (() => {
            const crumbs = fileOps.breadcrumb;
            const maxVisible = 3;
            const collapsed = crumbs.length > maxVisible;
            const visible = collapsed ? [crumbs[0], ...crumbs.slice(-2)] : crumbs;

            return visible.map((crumb, i) => {
              const isLast = i === visible.length - 1;
              const realIndex = collapsed && i > 0 ? crumbs.length - (visible.length - i) : i;
              return (
                <span key={`${i}-${crumb.id ?? "root"}`} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-text-disabled">/</span>}
                  {i === 1 && collapsed && (
                    <>
                      <span className="text-text-disabled">...</span>
                      <span className="text-text-disabled">/</span>
                    </>
                  )}
                  {!isLast ? (
                    <button
                      onClick={() => fileOps.navigateToBreadcrumb(realIndex)}
                      onDragOver={(e) => {
                        if (!dragFileId) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        e.currentTarget.style.color = "var(--accent-green-primary)";
                      }}
                      onDragLeave={(e) => {
                        e.currentTarget.style.color = "";
                      }}
                      onDrop={async (e) => {
                        e.preventDefault();
                        e.currentTarget.style.color = "";
                        if (!dragFileId) return;
                        const source = fileOps.files.find((f) => f.id === dragFileId);
                        if (!source) return;
                        setDragFileId(null);
                        // Fetch destination folder's public hier key
                        const destId = crumb.id;
                        if (destId) {
                          try {
                            const res = await fetch(`/api/files/chunk-download?fileId=${destId}`);
                            if (res.ok) {
                              const data = await res.json();
                              await fileOps.moveFile(source, destId, data.publicHierarchicalKey || null);
                            }
                          } catch { /* */ }
                        } else {
                          // Moving to root (null parent)
                          await fileOps.moveFile(source, null, null);
                        }
                      }}
                      className="text-text-secondary hover:text-text-primary cursor-pointer transition-colors bg-transparent border-none p-0 text-[13px] rounded px-1 -mx-1"
                    >
                      {crumb.name}
                    </button>
                  ) : (
                    <span className="text-text-primary font-medium">{crumb.name}</span>
                  )}
                </span>
              );
            });
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
          {/* Facepile + Invite — workspace context */}
          {fileOps.activeWorkspace && (
            <>
              <div className="hidden md:block">
                <Facepile members={workspaceMembers} onClick={() => setMembersOpen(true)} onOverflowClick={() => setMembersOpen(true)} />
              </div>
              {fileOps.callerPermission && fileOps.callerPermission !== "viewer" && fileOps.callerPermission !== "editor" && (
                <button
                  onClick={() => setWorkspaceInviteOpen(true)}
                  className="hidden md:flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer"
                >
                  <HugeiconsIcon icon={UserAdd01Icon} size={14} />
                  Invite
                </button>
              )}
            </>
          )}
          {/* No Facepile/Invite in personal — file-level sharing uses
              the context menu Share action instead */}
          {(fileOps.viewMode === "own" || fileOps.currentFolder) && fileOps.viewMode !== "trash" && (!fileOps.activeWorkspace || (fileOps.callerPermission && fileOps.callerPermission !== "viewer")) && (
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
          {/* List/Grid toggle */}
          <div className="hidden md:flex items-center h-[30px] rounded-[8px] border border-border-secondary overflow-hidden">
            <button
              onClick={() => { setLayout("list"); localStorage.setItem("securewarp_layout", "list"); }}
              className={`flex items-center justify-center w-[30px] h-full transition-colors cursor-pointer ${layout === "list" ? "bg-bg-overlay-tertiary text-text-primary" : "text-text-disabled hover:text-text-tertiary"}`}
            >
              <HugeiconsIcon icon={LeftToRightListBulletIcon} size={14} />
            </button>
            <button
              onClick={() => { setLayout("grid"); localStorage.setItem("securewarp_layout", "grid"); }}
              className={`flex items-center justify-center w-[30px] h-full transition-colors cursor-pointer ${layout === "grid" ? "bg-bg-overlay-tertiary text-text-primary" : "text-text-disabled hover:text-text-tertiary"}`}
            >
              <HugeiconsIcon icon={GridViewIcon} size={14} />
            </button>
          </div>
          <NotificationBell />
        </div>
      </div>


      {/* Label filter banner */}
      {filterLabel && (
        <div className="mx-3 md:mx-5 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-overlay-tertiary animate-fade-in">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: filterLabel.color }} />
          <span className="text-[12px] text-text-secondary flex-1">Filtering by <strong>{filterLabel.name}</strong></span>
          <button onClick={() => setFilterLabel(null)} className="text-[11px] text-text-link hover:underline cursor-pointer">Clear</button>
        </div>
      )}

      {/* Error banner */}
      {fileOps.error && !fileOps.error.toLowerCase().includes("quota") && !fileOps.error.toLowerCase().includes("storage") && (
        <div className="mx-5 mt-2 flex items-center justify-between px-3 py-2 rounded-lg bg-accent-red/10 border border-accent-red/20 animate-fade-in">
          <span className="text-[12px] text-accent-red">{fileOps.error}</span>
          <button onClick={() => fileOps.clearError()} className="text-[11px] text-accent-red/60 hover:text-accent-red transition-colors cursor-pointer ml-3 shrink-0">Dismiss</button>
        </div>
      )}


      {/* Selection bar — hidden during active rubber-band drag so the
          layout doesn't shift mid-selection (which would push the file
          list down and misalign the drag anchor). Reappears on mouseup. */}
      {!showActivity && !rubberBand && selected.size > 0 && (
        <div className="hidden md:flex mx-5 mt-2 items-center gap-3 px-4 h-[36px] rounded-[8px] bg-bg-overlay-tertiary text-[12px] text-text-secondary animate-fade-in">
          <span className="font-medium text-text-primary">{selected.size} selected</span>
          <span className="text-text-disabled">·</span>
          <span className="text-text-disabled">{(() => {
            let total = 0;
            for (const id of selected) {
              const f = fileOps.files.find((x) => x.id === id);
              if (f && !f.isFolder) total += f.size;
            }
            if (total === 0) return "—";
            const units = ["B", "KB", "MB", "GB"];
            let i = 0; let s = total;
            while (s >= 1024 && i < units.length - 1) { s /= 1024; i++; }
            return `${s.toFixed(s < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
          })()}</span>
          <button onClick={selectNone} className="text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer">Clear</button>
          <button onClick={selectAll} className="text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer">Select all</button>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={async () => {
                const ids = [...selected].filter((id) => {
                  const f = fileOps.files.find((x) => x.id === id);
                  return f && !f.isFolder;
                });
                for (const id of ids) {
                  await fileOps.downloadFile(id);
                }
              }}
              title={`Download ${[...selected].filter(id => !fileOps.files.find(f => f.id === id)?.isFolder).length} files`}
              className="p-1.5 rounded-md hover:bg-cta-nav-hover transition-colors cursor-pointer text-icon-secondary"
            >
              <HugeiconsIcon icon={Download04Icon} size={15} />
            </button>
            {fileOps.callerPermission !== "viewer" && (
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
            )}
            {fileOps.callerPermission !== "viewer" && (
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
            )}
            {fileOps.callerPermission !== "viewer" && (
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
            )}
            {selected.size === 1 && (
              <button
                onClick={() => {
                  const first = fileOps.files.find((f) => selected.has(f.id));
                  if (first) setDetailsTarget(first);
                }}
                title="Details"
                className="p-1.5 rounded-md hover:bg-cta-nav-hover transition-colors cursor-pointer text-icon-secondary"
              >
                <HugeiconsIcon icon={InformationCircleIcon} size={15} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      {/* Table header — sticky above scroll area */}
      {!showActivity && displayFiles.length > 0 && layout === "list" && (
        <div className="hidden md:flex items-center h-[40px] px-4 mx-3 md:mx-5 box-border select-none shrink-0">
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
              <span className="text-[11px] font-mono uppercase text-text-disabled">{fileOps.activeWorkspace ? "Owner" : "Shared"}</span>
            </div>
            <div className="w-[100px] justify-end hidden lg:flex">
              <button onClick={() => toggleSort("modified")} className="flex items-center gap-1 text-[11px] font-mono uppercase text-text-disabled hover:text-text-tertiary cursor-pointer transition-colors">
                Modified <SortArrow field="modified" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activity page (workspace admin) */}
      {showActivity && fileOps.activeWorkspace && (
        <WorkspaceActivityPage workspaceId={fileOps.activeWorkspace.id} />
      )}

      {/* Scrollable file list */}
      {!showActivity && <div
        ref={fileListRef}
        className={`flex-1 overflow-y-auto px-3 md:px-5 pt-1 pb-4 flex flex-col relative${rubberBand ? " select-none" : ""}`}
        onClick={() => setContextMenu(null)}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest("[data-file-item]")) return;
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, fileId: null, isFolder: false });
        }}
        onMouseDown={(e) => {
          // Only start rubber band on left click on empty space
          if (e.button !== 0) return;
          if ((e.target as HTMLElement).closest("[data-file-item]")) return;
          if ((e.target as HTMLElement).closest("button")) return;
          const container = fileListRef.current;
          if (!container) return;
          // preventDefault stops native text-selection drag on empty space.
          e.preventDefault();
          // Store coords in CONTENT space, not viewport. If the list scrolls
          // during the drag (auto-scroll, wheel, trackpad), viewport-anchored
          // coords go stale and selection drifts — items near the top of
          // the list get picked up even when the user is dragging lower
          // down. Content coords stay correct regardless of scroll.
          const rect = container.getBoundingClientRect();
          const x = e.clientX - rect.left + container.scrollLeft;
          const y = e.clientY - rect.top + container.scrollTop;
          setRubberBand({ startX: x, startY: y, currentX: x, currentY: y });
          if (!e.shiftKey) selectNone();
        }}
        onMouseMove={(e) => {
          if (!rubberBand) return;
          const container = fileListRef.current;
          if (!container) return;
          const rect = container.getBoundingClientRect();
          const curX = e.clientX - rect.left + container.scrollLeft;
          const curY = e.clientY - rect.top + container.scrollTop;
          setRubberBand((prev) => prev ? { ...prev, currentX: curX, currentY: curY } : null);
          // Check intersections with file items using content-space coords
          // for both the band and the item rects.
          const items = container.querySelectorAll("[data-file-item]");
          const newSelected = new Set<string>();
          const bandLeft = Math.min(rubberBand.startX, curX);
          const bandRight = Math.max(rubberBand.startX, curX);
          const bandTop = Math.min(rubberBand.startY, curY);
          const bandBottom = Math.max(rubberBand.startY, curY);
          items.forEach((item) => {
            const ir = item.getBoundingClientRect();
            const itemLeft = ir.left - rect.left + container.scrollLeft;
            const itemTop = ir.top - rect.top + container.scrollTop;
            const itemRight = itemLeft + ir.width;
            const itemBottom = itemTop + ir.height;
            if (itemLeft < bandRight && itemRight > bandLeft && itemTop < bandBottom && itemBottom > bandTop) {
              const id = item.getAttribute("data-file-id");
              if (id) newSelected.add(id);
            }
          });
          setSelected(newSelected);
        }}
        onMouseUp={() => { setRubberBand(null); }}
        onMouseLeave={() => { setRubberBand(null); }}
      >

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
                    Starred files will appear here.
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
                    Deleted files land here. Right click to restore.
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
                  <h3 className="text-[18px] font-semibold text-text-primary mb-2">Nothing shared yet</h3>
                  <p className="text-[13px] text-text-tertiary leading-relaxed mb-6">
                    Files shared with you will appear here.
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
              ) : fileOps.callerPermission === "viewer" ? (
                <>
                  <h3 className="text-[18px] font-semibold text-text-primary mb-2">No files yet</h3>
                  <p className="text-[13px] text-text-tertiary leading-relaxed">
                    Files added by other members will appear here.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-[18px] font-semibold text-text-primary mb-2">Your vault is empty</h3>
                  <p className="text-[13px] text-text-tertiary leading-relaxed mb-6">
                    Upload a file or create a folder to get started.
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

        {/* Loading skeleton — only show when no files to display yet */}
        {(fileOps.loading || !fileOps.initialized) && displayFiles.length === 0 && (
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

        {/* Rubber band selection overlay — positioned in content space
            (absolute inside the scrolling container) so it scrolls with
            the list and stays aligned with the selection math. */}
        {rubberBand && (() => {
          const left = Math.min(rubberBand.startX, rubberBand.currentX);
          const top = Math.min(rubberBand.startY, rubberBand.currentY);
          const width = Math.abs(rubberBand.currentX - rubberBand.startX);
          const height = Math.abs(rubberBand.currentY - rubberBand.startY);
          if (width < 5 && height < 5) return null;
          return (
            <div style={{ position: "absolute", left, top, width, height, border: "1px solid rgb(239,90,60)", background: "rgba(239,90,60,0.08)", borderRadius: 4, pointerEvents: "none", zIndex: 50 }} />
          );
        })()}

        <div className={layout === "grid" ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2" : ""}>
        {displayFiles.map((file, fileIndex) => {
          const isSelected = selected.has(file.id);
          const isFocused = fileIndex === focusedIndex;
          return layout === "grid" ? (
            /* ─── GRID CARD ─── */
            <div
              data-file-item
              data-file-id={file.id}
              key={file.id}
              draggable={fileOps.viewMode === "own" && !file.uploading && fileOps.callerPermission !== "viewer"}
              onDragStart={(e) => {
                setDragFileId(file.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", file.id);
              }}
              onDragEnd={() => { setDragFileId(null); setDropTargetId(null); }}
              onDragOver={(e) => {
                if (!dragFileId || !file.isFolder || dragFileId === file.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropTargetId(file.id);
              }}
              onDragLeave={() => { if (dropTargetId === file.id) setDropTargetId(null); }}
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
              onMouseEnter={() => {
                if (file.isFolder && fileOps.viewMode === "own") {
                  prefetchTimerRef.current = setTimeout(() => fileOps.prefetchFolder(file.id), 200);
                }
              }}
              onMouseLeave={() => {
                if (prefetchTimerRef.current) { clearTimeout(prefetchTimerRef.current); prefetchTimerRef.current = null; }
              }}
              onClick={() => {
                // Any click on the row counts as "seen" — dismisses the
                // NEW badge immediately.
                newFiles.markSeen(file.id);
                if (file.isFolder && fileOps.viewMode !== "trash") {
                  fileOps.navigateToFolder(file.id, file.name);
                } else if (!file.isFolder && !file.uploading && fileOps.viewMode !== "trash") {
                  setPreviewFileId(file.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                newFiles.markSeen(file.id);
                setContextMenu({ x: e.clientX, y: e.clientY, fileId: file.id, isFolder: !!file.isFolder });
              }}
              className={`group relative flex flex-col items-center justify-center rounded-xl border cursor-pointer transition-colors p-4 min-h-[130px] ${
                dropTargetId === file.id
                  ? "border-accent-green bg-accent-green/5"
                  : dragFileId === file.id
                    ? "opacity-40 border-border-tertiary"
                    : isSelected
                      ? "border-accent-green/20 bg-bg-overlay-tertiary"
                      : isFocused
                        ? "border-border-secondary bg-bg-overlay-tertiary"
                        : "border-border-tertiary hover:border-border-secondary hover:bg-bg-overlay-tertiary"
              }`}
            >
              {/* Checkbox — top left on hover */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleSelect(file.id); }}
                className={`absolute top-2.5 left-2.5 w-[18px] h-[18px] rounded-[4px] border flex items-center justify-center cursor-pointer transition-all ${
                  isSelected ? "border-accent-green bg-accent-green" : "border-border-primary opacity-0 group-hover:opacity-100"
                }`}
              >
                {isSelected && <HugeiconsIcon icon={Tick01Icon} size={12} color="white" />}
              </button>
              {/* Context menu — top right on hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setContextMenu({ x: rect.right, y: rect.bottom, fileId: file.id, isFolder: !!file.isFolder });
                }}
                className="absolute top-2.5 right-2.5 p-1 rounded-md text-icon-tertiary hover:bg-cta-nav-hover transition-all cursor-pointer opacity-0 group-hover:opacity-100"
              >
                <HugeiconsIcon icon={MoreHorizontalIcon} size={14} />
              </button>
              {/* Icon / Thumbnail */}
              <div className={file.type === "image" && !file.uploading ? "mb-2 w-full" : "mb-3"}>
                {file.uploading ? (
                  <div className="flex justify-center">
                    <svg width="32" height="32" viewBox="0 0 28 28" style={{ animation: "spin 0.75s linear infinite" }}>
                      <circle cx="14" cy="14" r="11" fill="none" stroke="var(--bg-overlay-tertiary)" strokeWidth="2" />
                      <circle cx="14" cy="14" r="11" fill="none" stroke="var(--accent-green-primary)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 11 * 0.3} ${2 * Math.PI * 11 * 0.7}`} style={{ transformOrigin: "center", transform: "rotate(-90deg)" }} />
                    </svg>
                  </div>
                ) : (
                  <GridThumbnail fileId={file.id} kind={file.type as FileKind} previewFile={fileOps.previewFile} />
                )}
              </div>
              <span className={`text-[12px] text-center truncate w-full ${file.uploading ? "text-text-tertiary" : "text-text-primary"}`}>{file.name}</span>
              {file.uploading ? (
                <span className="text-[10px] text-accent-green mt-0.5">{fileOps.uploadStep || "Processing..."}</span>
              ) : !file.isFolder ? (
                <span className="text-[10px] text-text-disabled mt-0.5">{file.size}</span>
              ) : null}
            </div>
          ) : (
            /* ─── LIST ROW ─── */
            <div
              data-file-item
              data-file-id={file.id}
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
              onMouseEnter={() => {
                if (file.isFolder && fileOps.viewMode === "own") {
                  prefetchTimerRef.current = setTimeout(() => fileOps.prefetchFolder(file.id), 200);
                }
              }}
              onMouseLeave={() => {
                if (prefetchTimerRef.current) { clearTimeout(prefetchTimerRef.current); prefetchTimerRef.current = null; }
              }}
              onClick={() => {
                // Any click on the row counts as "seen" — dismisses the
                // NEW badge immediately.
                newFiles.markSeen(file.id);
                if (file.isFolder && fileOps.viewMode !== "trash") {
                  fileOps.navigateToFolder(file.id, file.name);
                } else if (!file.isFolder && !file.uploading && fileOps.viewMode !== "trash") {
                  setPreviewFileId(file.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                newFiles.markSeen(file.id);
                setContextMenu({ x: e.clientX, y: e.clientY, fileId: file.id, isFolder: !!file.isFolder });
              }}
              className={`group flex items-center min-h-[64px] md:min-h-[56px] h-[64px] md:h-[56px] px-4 rounded-xl border cursor-pointer transition-colors mb-1.5 shrink-0 ${
                dropTargetId === file.id
                  ? "border-accent-green bg-accent-green/5"
                  : dragFileId === file.id
                    ? "opacity-40 border-border-tertiary"
                    : isSelected
                      ? "border-accent-green/20 bg-bg-overlay-tertiary"
                      : isFocused
                        ? "border-border-secondary bg-bg-overlay-tertiary"
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
                    {file.isNew && (
                      <span
                        className="text-[9px] font-mono font-semibold tracking-wider px-1.5 py-0.5 rounded shrink-0"
                        style={{
                          background: "rgba(239,90,60,0.12)",
                          color: "rgba(239,90,60,0.95)",
                          border: "1px solid rgba(239,90,60,0.25)",
                          lineHeight: 1,
                        }}
                      >
                        NEW
                      </span>
                    )}
                    {!fileOps.activeWorkspace && fileOps.files.find((f) => f.id === file.id)?.isStarred && (
                      <HugeiconsIcon icon={StarIcon} size={12} color="var(--accent-yellow-primary)" className="shrink-0" />
                    )}
                    {!fileOps.activeWorkspace && (fileOps.files.find((f) => f.id === file.id)?.fileLabels ?? []).map((label) => (
                      <div key={label.id} className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: label.color }} title={label.name} />
                    ))}
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
                  {fileOps.activeWorkspace && file.ownerEmail ? (
                    <Tooltip label={userLabel({ email: file.ownerEmail, displayName: file.ownerDisplayName })}>
                      <div className="flex items-center justify-end">
                        <div
                          className="w-6 h-6 rounded-[5px] flex items-center justify-center text-[9px] font-bold text-white"
                          style={{ backgroundColor: userColor({ email: file.ownerEmail }) }}
                        >
                          {userInitials({ email: file.ownerEmail, displayName: file.ownerDisplayName })}
                        </div>
                      </div>
                    </Tooltip>
                  ) : (
                    <CollaboratorStack collaborators={file.collaborators} />
                  )}
                </div>
                <div className={`w-[100px] justify-end hidden lg:flex transition-opacity ${
                  contextMenu?.fileId === file.id ? "opacity-0" : "group-hover:opacity-0"
                }`}>
                  <span className="text-[12px] text-text-disabled">{file.modified}</span>
                </div>

                {/* Hover actions */}
                <div className={`absolute right-0 flex items-center gap-0.5 transition-opacity ${
                  contextMenu?.fileId === file.id ? "opacity-100 pointer-events-auto" : "opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                }`}>
                  {!fileOps.activeWorkspace && (() => {
                    const starred = fileOps.files.find((f) => f.id === file.id)?.isStarred;
                    return (
                      <Tooltip label={starred ? "Unstar" : "Star"} side="bottom">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const full = fileOps.files.find((f) => f.id === file.id);
                            if (full) fileOps.toggleStar(full.id, !full.isStarred);
                          }}
                          className={`p-1.5 rounded-md hover:bg-cta-nav-hover transition-colors cursor-pointer ${
                            starred
                              ? "text-accent-yellow"
                              : "text-icon-tertiary hover:text-accent-yellow"
                          }`}
                        >
                          <HugeiconsIcon icon={StarIcon} size={15} />
                        </button>
                      </Tooltip>
                    );
                  })()}
                  {fileOps.viewMode === "own" && fileOps.callerPermission !== "viewer" && (
                    <Tooltip label="Share" side="bottom">
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
                    </Tooltip>
                  )}
                  {/* Download — moved out of the context menu (which
                      was overflowing). Single click on the hover strip
                      triggers the same file-ops download path. Files
                      only; folders don't download as a unit yet. */}
                  {fileOps.viewMode !== "trash" && !file.isFolder && (
                    <Tooltip label="Download" side="bottom">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          newFiles.markSeen(file.id);
                          fileOps.downloadFile(file.id);
                        }}
                        className="p-1.5 rounded-md text-icon-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer"
                      >
                        <HugeiconsIcon icon={Download04Icon} size={15} />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip label="More" side="bottom">
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
                  </Tooltip>
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

        {/* Load more button for paginated results */}
        {fileOps.nextCursor && (
          <div className="flex justify-center py-4">
            <button
              onClick={() => fileOps.loadMore()}
              className="h-[34px] px-5 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer"
            >
              Load more files
            </button>
          </div>
        )}
      </div>}

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
                ? (() => {
                    const left = Math.min(contextMenu.x, window.innerWidth - 200);
                    const MARGIN = 8;
                    // Anchor to whichever side has more room. The old
                    // rule ("if clicked in bottom half, anchor bottom")
                    // forced a scroll when the menu grew past that
                    // side's height even if the other side had plenty
                    // of space. Preferring the bigger side keeps the
                    // menu one-piece in almost every realistic click.
                    const spaceBelow = window.innerHeight - contextMenu.y - MARGIN;
                    const spaceAbove = contextMenu.y - MARGIN;
                    const anchorBelow = spaceBelow >= spaceAbove;
                    return anchorBelow
                      ? {
                          position: "fixed" as const,
                          top: contextMenu.y,
                          left,
                          width: 180,
                          borderRadius: 8,
                          maxHeight: spaceBelow,
                          overflowY: "auto" as const,
                        }
                      : {
                          position: "fixed" as const,
                          bottom: window.innerHeight - contextMenu.y,
                          left,
                          width: 180,
                          borderRadius: 8,
                          maxHeight: spaceAbove,
                          overflowY: "auto" as const,
                        };
                  })()
                : {}),
              boxShadow: "var(--shadow-l2)",
            }}
          >
            {/* Bottom sheet handle (mobile only) */}
            <div className="flex justify-center pb-2 md:hidden">
              <div className="w-10 h-1 rounded-full bg-border-secondary" />
            </div>
          {/* Empty space context menu */}
          {contextMenu.fileId === null ? (
            <>
              {fileOps.callerPermission !== "viewer" && (!fileOps.activeWorkspace || (fileOps.callerPermission && fileOps.callerPermission !== "viewer")) && (
                <>
                  <button
                    onClick={() => { setNewFolderOpen(true); setContextMenu(null); }}
                    className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
                  >
                    <HugeiconsIcon icon={FolderAddIcon} size={14} color="var(--icon-tertiary)" /> New folder
                  </button>
                  <button
                    onClick={() => { fileInputRef.current?.click(); setContextMenu(null); }}
                    className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
                  >
                    <HugeiconsIcon icon={Upload04Icon} size={14} color="var(--icon-tertiary)" /> Upload files
                  </button>
                </>
              )}
              <button
                onClick={() => { selectAll(); setContextMenu(null); }}
                className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={Tick01Icon} size={14} color="var(--icon-tertiary)" /> Select all
              </button>
            </>
          ) : (
          <>
          {fileOps.viewMode !== "trash" && (
            <>
              <button
                onClick={() => {
                  if (!contextMenu) return;
                  const full = fileOps.files.find((f) => f.id === contextMenu.fileId!);
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
                    const full = fileOps.files.find((f) => f.id === contextMenu.fileId!);
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
              {!fileOps.activeWorkspace && (
                <button
                  onClick={() => {
                    if (!contextMenu) return;
                    const full = fileOps.files.find((f) => f.id === contextMenu.fileId!);
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
              )}
              {!fileOps.activeWorkspace && (
                <button
                  onClick={async () => {
                    if (!contextMenu) return;
                    const isPinned = pinnedIds.has(contextMenu.fileId!);
                    const full = fileOps.files.find((f) => f.id === contextMenu.fileId!);
                    await fetch("/api/pins", {
                      method: isPinned ? "DELETE" : "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ fileId: contextMenu.fileId! }),
                    });
                    setPinnedIds((prev) => {
                      const next = new Set(prev);
                      if (isPinned) {
                        next.delete(contextMenu.fileId!);
                        try {
                          const cache = JSON.parse(localStorage.getItem("securewarp_pin_names") || "{}");
                          delete cache[contextMenu.fileId!];
                          localStorage.setItem("securewarp_pin_names", JSON.stringify(cache));
                        } catch { /* */ }
                      } else {
                        next.add(contextMenu.fileId!);
                        if (full) {
                          try {
                            const cache = JSON.parse(localStorage.getItem("securewarp_pin_names") || "{}");
                            cache[contextMenu.fileId!] = full.name;
                            localStorage.setItem("securewarp_pin_names", JSON.stringify(cache));
                          } catch { /* */ }
                        }
                      }
                      return next;
                    });
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
                >
                  <HugeiconsIcon icon={PinIcon} size={14} color="var(--icon-tertiary)" />
                  {pinnedIds.has(contextMenu?.fileId ?? "") ? "Unpin from sidebar" : "Pin to sidebar"}
                </button>
              )}
              {!fileOps.activeWorkspace && userLabels.length > 0 && (() => {
                const fileEntry = fileOps.files.find((f) => f.id === contextMenu?.fileId);
                const assignedIds = new Set((fileEntry?.fileLabels ?? []).map((l) => l.id));
                return (
                  <div className="border-t border-border-tertiary mt-1 pt-1">
                    <p className="px-3 py-1 text-[10px] font-mono uppercase text-text-disabled">Labels</p>
                    <div className="max-h-[120px] overflow-y-auto">
                    {userLabels.map((label) => {
                      const isAssigned = assignedIds.has(label.id);
                      return (
                        <button
                          key={label.id}
                          onClick={async () => {
                            if (!contextMenu) return;
                            await fetch("/api/labels/assign", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ fileId: contextMenu.fileId!, labelId: label.id, action: isAssigned ? "remove" : "add" }),
                            });
                            fileOps.invalidateCache();
                            await fileOps.fetchFiles(fileOps.currentFolder, fileOps.viewMode);
                            setContextMenu(null);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
                        >
                          <div className="w-[10px] h-[10px] rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                          <span className="flex-1 text-left">{label.name}</span>
                          {isAssigned && <span className="text-accent-green text-[10px]">✓</span>}
                        </button>
                      );
                    })}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
          {fileOps.viewMode === "trash" && (
            <button
              onClick={async () => {
                if (!contextMenu) return;
                const fileId = contextMenu.fileId!;
                setContextMenu(null);
                await fileOps.restoreItem(fileId);
              }}
              className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} color="var(--icon-tertiary)" /> Restore
            </button>
          )}
          {fileOps.viewMode === "own" && fileOps.callerPermission !== "viewer" && (
            <button
              onClick={() => {
                if (contextMenu) {
                  const full = fileOps.files.find((f) => f.id === contextMenu.fileId!);
                  if (full) setShareTarget(full);
                }
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Share01Icon} size={14} color="var(--icon-tertiary)" /> Share
            </button>
          )}
          {/* Version history — non-folder files only. Available to anyone
              with access; restore/delete/upload-new-version all gate
              on ownership inside the modal. Replaces both the old
              "Download" and "Replace file..." menu entries. */}
          {fileOps.viewMode !== "trash" && !contextMenu?.isFolder && (
            <button
              onClick={() => {
                if (contextMenu) {
                  const full = fileOps.files.find((f) => f.id === contextMenu.fileId!);
                  if (full) setVersionHistoryTarget(full);
                }
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Clock01Icon} size={14} color="var(--icon-tertiary)" /> Version history
            </button>
          )}
          {fileOps.viewMode !== "trash" && (
            <>
              {fileOps.callerPermission !== "viewer" && (
                <button
                  onClick={() => {
                    if (!contextMenu) return;
                    const full = fileOps.files.find((f) => f.id === contextMenu.fileId!);
                    if (full) setMoveTarget(full);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
                >
                  <HugeiconsIcon icon={Move01Icon} size={14} color="var(--icon-tertiary)" /> Move to
                </button>
              )}
            </>
          )}
          <div className="h-px bg-border-tertiary my-1" />
          {fileOps.viewMode === "trash" ? (
            <button
              onClick={() => {
                if (!contextMenu) return;
                const full = fileOps.files.find((f) => f.id === contextMenu.fileId!);
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
                const fileId = contextMenu.fileId!;
                setContextMenu(null);
                await fileOps.leaveShare(fileId);
              }}
              className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-accent-red hover:bg-bg-cell-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} /> Remove from shared
            </button>
          ) : fileOps.callerPermission !== "viewer" ? (
            <button
              onClick={() => {
                if (contextMenu) {
                  fileOps.deleteItem(contextMenu.fileId!);
                  setContextMenu(null);
                }
              }}
              className="w-full flex items-center gap-2.5 px-3 h-[44px] md:h-[30px] text-[14px] md:text-[12px] text-accent-red hover:bg-bg-cell-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} /> Trash
            </button>
          ) : null}
          </>
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
          // Clear the selection bar — the selected rows just got
          // purged, so "N selected" pointing at ghost IDs is stale.
          selectNone();
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
          const purgedId = purgeTarget.id;
          await fileOps.purgeItem(purgedId);
          setPurgeBusy(false);
          setPurgeTarget(null);
          // Drop just this id from the selection so the bar
          // reflects reality without discarding other selections.
          setSelected((prev) => {
            if (!prev.has(purgedId)) return prev;
            const next = new Set(prev);
            next.delete(purgedId);
            return next;
          });
        }}
        onCancel={() => !purgeBusy && setPurgeTarget(null)}
      />
      <FilePreview
        fileId={previewFileId}
        fileIds={displayFiles.filter((f) => !f.isFolder && !f.uploading).map((f) => f.id)}
        onClose={() => setPreviewFileId(null)}
        onNavigate={setPreviewFileId}
      />
      <StorageQuotaModal open={quotaModalOpen} onClose={() => setQuotaModalOpen(false)} />
      <MoveModal file={moveTarget} onClose={() => setMoveTarget(null)} />
      <ShareModal file={shareTarget} onClose={() => setShareTarget(null)} />
      <UploadPanel queue={fileOps.uploadQueue} onDismiss={fileOps.dismissUpload} />
      <VersionHistoryModal
        file={
          versionHistoryTarget
            ? {
                id: versionHistoryTarget.id,
                name: versionHistoryTarget.name,
                isOwner:
                  keys != null &&
                  (versionHistoryTarget.ownerEmail === keys.email ||
                    fileOps.viewMode === "own"),
                encryptedPrivateHierarchicalKey: versionHistoryTarget.encryptedPrivateHierarchicalKey,
                wrappedByPublicKey: versionHistoryTarget.wrappedByPublicKey,
                ownerPublicKey: versionHistoryTarget.ownerPublicKey,
                encryptedSessionKeyByFile: versionHistoryTarget.encryptedSessionKeyByFile,
                sessionKeyNonce: versionHistoryTarget.sessionKeyNonce,
              }
            : null
        }
        onClose={() => setVersionHistoryTarget(null)}
        listVersions={fileOps.listVersions}
        restoreVersion={fileOps.restoreVersion}
        deleteVersion={fileOps.deleteVersion}
        replaceFile={fileOps.replaceFile}
        onActionComplete={() => {
          void fileOps.fetchFiles(fileOps.currentFolder);
        }}
      />
      <FileDetailsModal file={detailsTarget} onClose={() => setDetailsTarget(null)} />
      <MembersModal
        open={membersOpen}
        onClose={() => setMembersOpen(false)}
        workspaceId={fileOps.activeWorkspace?.id ?? null}
        isAdmin={fileOps.callerPermission === "admin" || fileOps.callerPermission === "owner"}
      />
      <WorkspaceSettings
        open={workspaceSettingsOpen}
        onClose={() => setWorkspaceSettingsOpen(false)}
        workspace={fileOps.activeWorkspace ? { ...fileOps.activeWorkspace, role: fileOps.callerPermission === "viewer" ? "viewer" : fileOps.callerPermission === "editor" ? "editor" : "admin", ownerId: wsOwnerId } : null}
        onDeleted={() => { setWorkspaceSettingsOpen(false); fileOps.leaveWorkspace(); }}
      />
      <WorkspaceInviteModal
        open={workspaceInviteOpen}
        onClose={() => setWorkspaceInviteOpen(false)}
        workspaceId={fileOps.activeWorkspace?.id ?? null}
        rootFolderId={fileOps.activeWorkspace?.rootFolderId ?? null}
        defaultRole={wsDefaultRole}
      />
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onAction={(action) => {
          switch (action) {
            case "a1": fileInputRef.current?.click(); break;
            case "a2": setNewFolderOpen(true); break;
            case "a3": {
              if (fileOps.callerPermission !== "viewer") {
                const first = fileOps.files[0];
                if (first) setShareTarget(first);
              }
              break;
            }
            case "a5": fileOps.setViewMode("starred"); break;
            case "a6": fileOps.setViewMode("trash"); break;
          }
        }}
        onOpenFile={(fileId, isFolder, name) => {
          if (isFolder) {
            // Prefer the locally-loaded files list for the freshest
            // name, but fall back to the name passed from the search
            // result (or, finally, a generic placeholder) so the
            // breadcrumb never shows the literal word "Folder".
            const f = fileOps.files.find((x) => x.id === fileId);
            const resolvedName = f?.name ?? name ?? "Folder";
            fileOps.navigateToFolder(fileId, resolvedName);
          } else {
            setPreviewFileId(fileId);
          }
        }}
      />

      {/* Mobile FAB for upload + new folder */}
      {fileOps.viewMode !== "trash" && (!fileOps.activeWorkspace || (fileOps.callerPermission && fileOps.callerPermission !== "viewer")) && (fileOps.viewMode === "own" || fileOps.currentFolder) && (
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
