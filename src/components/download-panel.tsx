"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import ArrowUp01Icon from "@hugeicons/core-free-icons/ArrowUp01Icon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
import type { DownloadRecord } from "@/hooks/use-files";

interface DownloadPanelProps {
  queue: DownloadRecord[];
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

export function DownloadPanel({ queue, onDismiss }: DownloadPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (queue.some((r) => r.status === "downloading")) {
      setCollapsed(false);
    }
  }, [queue.length, queue]);

  if (queue.length === 0) return null;

  const inFlight = queue.filter((r) => r.status === "downloading").length;
  const headerLabel =
    inFlight > 0
      ? `Downloading ${inFlight} ${inFlight === 1 ? "file" : "files"}`
      : `${queue.length} ${queue.length === 1 ? "download" : "downloads"} complete`;

  return (
    <div
      className="w-[320px] max-w-[calc(100vw-32px)] rounded-[12px] bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in"
      style={{ boxShadow: "var(--shadow-l2)" }}
    >
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-border-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <HugeiconsIcon
            icon={Download04Icon}
            size={14}
            color="var(--text-link)"
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

      {!collapsed && (
        <div className="max-h-[280px] overflow-y-auto">
          {queue.map((r) => (
            <DownloadPanelRow key={r.id} record={r} onDismiss={onDismiss} />
          ))}
        </div>
      )}
    </div>
  );
}

function DownloadPanelRow({
  record,
  onDismiss,
}: {
  record: DownloadRecord;
  onDismiss: (id: string) => void;
}) {
  const isDone = record.status === "done";
  const isError = record.status === "error";
  const icon = isError ? Alert02Icon : isDone ? Tick01Icon : Download04Icon;
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
              background: "var(--text-link)",
            }}
          />
        </div>
      )}
    </div>
  );
}
