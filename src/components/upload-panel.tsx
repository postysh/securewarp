"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import ArrowUp01Icon from "@hugeicons/core-free-icons/ArrowUp01Icon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Upload04Icon from "@hugeicons/core-free-icons/Upload04Icon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
import type { UploadRecord } from "@/hooks/use-files";

/**
 * Floating bottom-right upload panel. Mirrors the pattern used by
 * Dropbox / Google Drive / OneDrive: a fixed-position pill that
 * lists every in-flight + recently-finished upload with a progress
 * bar. Persists across folder navigation because its state lives on
 * the useFiles hook, not on the current file-browser render.
 *
 * Collapsible header; auto-collapses itself when every item is done
 * and the list is empty.
 */

interface UploadPanelProps {
  queue: UploadRecord[];
  onDismiss: (id: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function UploadPanel({ queue, onDismiss }: UploadPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Auto-open when a new upload starts so users see it without hunting.
  useEffect(() => {
    if (queue.some((r) => r.status === "uploading")) {
      setCollapsed(false);
    }
  }, [queue.length, queue]);

  if (queue.length === 0) return null;

  const inFlight = queue.filter((r) => r.status === "uploading").length;
  const headerLabel =
    inFlight > 0
      ? `Uploading ${inFlight} ${inFlight === 1 ? "file" : "files"}`
      : `${queue.length} ${queue.length === 1 ? "upload" : "uploads"} complete`;

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] w-[320px] max-w-[calc(100vw-32px)] rounded-[12px] bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in"
      style={{ boxShadow: "var(--shadow-l2)" }}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-border-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <HugeiconsIcon
            icon={Upload04Icon}
            size={14}
            color="var(--accent-green-primary)"
          />
          <span className="text-[12px] font-medium text-text-primary truncate">
            {headerLabel}
          </span>
        </div>
        <HugeiconsIcon
          icon={collapsed ? ArrowUp01Icon : ArrowDown01Icon}
          size={14}
          color="var(--icon-tertiary)"
        />
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="max-h-[280px] overflow-y-auto">
          {queue.map((r) => (
            <UploadPanelRow key={r.id} record={r} onDismiss={onDismiss} />
          ))}
        </div>
      )}
    </div>
  );
}

function UploadPanelRow({
  record,
  onDismiss,
}: {
  record: UploadRecord;
  onDismiss: (id: string) => void;
}) {
  const isDone = record.status === "done";
  const isError = record.status === "error";
  const icon = isError ? Alert02Icon : isDone ? Tick01Icon : Upload04Icon;
  const iconColor = isError
    ? "var(--accent-red-primary)"
    : isDone
      ? "var(--accent-green-primary)"
      : "var(--icon-tertiary)";

  return (
    <div className="px-3.5 py-2.5 border-b border-border-tertiary last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <HugeiconsIcon
            icon={icon}
            size={14}
            color={iconColor}
            className="mt-0.5 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] text-text-primary truncate">
                {record.name}
              </span>
              {record.kind === "version" && (
                <span
                  className="text-[9px] font-mono font-semibold uppercase tracking-wider px-1 py-[1px] rounded shrink-0"
                  style={{
                    background: "rgba(125,148,179,0.15)",
                    color: "var(--text-tertiary)",
                  }}
                >
                  New version
                </span>
              )}
            </div>
            <div className="text-[10px] text-text-disabled mt-0.5 font-mono">
              {isError ? (
                <span className="text-accent-red">{record.error ?? "Failed"}</span>
              ) : isDone ? (
                <>Done · {formatBytes(record.size)}</>
              ) : (
                <>
                  {record.progress}% · {formatBytes(record.size)}
                </>
              )}
            </div>
          </div>
        </div>
        {(isDone || isError) && (
          <button
            onClick={() => onDismiss(record.id)}
            className="p-1 rounded-md text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer shrink-0"
            aria-label="Dismiss"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} />
          </button>
        )}
      </div>
      {!isDone && !isError && (
        <div className="mt-1.5 h-[3px] rounded-full bg-bg-field overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-200"
            style={{
              width: `${record.progress}%`,
              background: "var(--accent-green-primary)",
            }}
          />
        </div>
      )}
    </div>
  );
}
