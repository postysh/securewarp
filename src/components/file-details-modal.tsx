"use client";

import { createPortal } from "react-dom";
import { useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
import type { DecryptedFile } from "@/hooks/use-files";
import { FileIcon, type FileKind } from "./file-icon";
import { colorForEmail } from "@/lib/avatar";
import { userLabel, userInitials, userColor } from "@/lib/display";

interface FileDetailsModalProps {
  file: DecryptedFile | null;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(size < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function getFileKind(name: string, type: string): FileKind {
  if (type === "folder") return "folder";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ico"].includes(ext)) return "image";
  if (["pdf"].includes(ext)) return "pdf";
  if (["doc", "docx", "txt", "rtf", "odt"].includes(ext)) return "document";
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return "spreadsheet";
  if (["mp3", "wav", "ogg", "flac", "aac", "m4a"].includes(ext)) return "audio";
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "video";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  if (["js", "ts", "tsx", "jsx", "py", "go", "rs", "c", "cpp", "java", "rb", "php", "html", "css", "json", "yaml", "xml", "sh", "md"].includes(ext)) return "code";
  if (["ppt", "pptx", "key"].includes(ext)) return "presentation";
  return "other";
}

export function FileDetailsModal({ file, onClose }: FileDetailsModalProps) {
  useEffect(() => {
    if (!file) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [file, onClose]);

  if (!file) return null;

  const ext = file.name.includes(".") ? file.name.split(".").pop()?.toUpperCase() : null;
  const kind = getFileKind(file.name, file.type);

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Type", value: file.isFolder ? "Folder" : (ext || "File") },
    ...(!file.isFolder ? [{ label: "Size", value: formatBytes(file.size) }] : []),
    { label: "Created", value: formatDate(file.createdAt) },
    { label: "Modified", value: formatDate(file.updatedAt) },
    ...(file.ownerEmail ? [{ label: "Owner", value: (
      <div className="flex items-center gap-2">
        <div
          className="w-5 h-5 rounded-[4px] flex items-center justify-center text-[8px] font-bold text-white"
          style={{ backgroundColor: colorForEmail(file.ownerEmail!) }}
        >
          {file.ownerEmail!.charAt(0).toUpperCase()}
        </div>
        <span className="text-[12px] text-text-primary">{file.ownerEmail}</span>
      </div>
    ) }] : []),
    ...(file.collaborators.length > 0 ? [{ label: "Shared with", value: (
      <div className="flex flex-col gap-1.5">
        {file.collaborators.filter(c => !c.isOwner).length === 0 ? (
          <span className="text-[12px] text-text-disabled">No one</span>
        ) : (
          file.collaborators.filter(c => !c.isOwner).map((c) => (
            <div key={c.userId} className="flex items-center gap-2 min-w-0">
              <div
                className="w-5 h-5 rounded-[4px] flex items-center justify-center text-[8px] font-bold text-white shrink-0"
                style={{ backgroundColor: userColor(c) }}
              >
                {userInitials(c)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-text-secondary truncate">{userLabel(c)}</p>
                {c.displayName?.trim() && c.email && (
                  <p className="text-[10px] text-text-disabled truncate">{c.email}</p>
                )}
              </div>
              <span className="text-[10px] text-text-disabled ml-auto shrink-0">{c.permissionLevel === "owner" ? "Owner" : c.permissionLevel === "editor" ? "Editor" : "Viewer"}</span>
            </div>
          ))
        )}
      </div>
    ) }] : []),
    ...(file.fileLabels.length > 0 ? [{ label: "Labels", value: (
      <div className="flex flex-wrap gap-1.5">
        {file.fileLabels.map((l) => (
          <div key={l.id} className="flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] bg-bg-overlay-tertiary">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
            <span className="text-[11px] text-text-secondary">{l.name}</span>
          </div>
        ))}
      </div>
    ) }] : []),
    { label: "File ID", value: (
      <span className="text-[11px] font-mono text-text-disabled select-all">{file.id}</span>
    ) },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        role="dialog" aria-modal="true" aria-label="File details"
        className="relative w-full h-full md:h-auto max-w-none md:max-w-[420px] mx-0 md:mx-4 rounded-none md:rounded-2xl bg-bg-l3 border-0 md:border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center shrink-0">
              <HugeiconsIcon icon={InformationCircleIcon} size={18} color="var(--accent-blue-primary)" />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-text-primary truncate">Details</div>
              <div className="text-[11px] text-text-disabled truncate">{file.name}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer shrink-0">
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
        </div>

        {/* File preview area */}
        <div className="flex items-center justify-center py-8 border-b border-border-tertiary">
          <div className="flex flex-col items-center gap-3">
            <FileIcon type={kind} size={36} />
            <div className="text-center">
              <p className="text-[14px] font-medium text-text-primary truncate max-w-[300px]">{file.name}</p>
              {!file.isFolder && (
                <p className="text-[12px] text-text-disabled mt-0.5">{formatBytes(file.size)}{ext ? ` · ${ext}` : ""}</p>
              )}
            </div>
          </div>
        </div>

        {/* Details rows */}
        <div className="px-5 py-4 overflow-y-auto" style={{ maxHeight: "min(50vh, 340px)" }}>
          {rows.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-4 py-2.5 border-b border-border-tertiary last:border-b-0">
              <span className="text-[11px] font-mono uppercase text-text-disabled tracking-wider shrink-0 pt-0.5">{row.label}</span>
              <div className="text-right min-w-0">
                {typeof row.value === "string" ? (
                  <span className="text-[12px] text-text-primary">{row.value}</span>
                ) : (
                  row.value
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border-tertiary flex justify-end">
          <button
            onClick={onClose}
            className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer active:scale-[0.98]"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
