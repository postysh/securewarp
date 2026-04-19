"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import CloudServerIcon from "@hugeicons/core-free-icons/CloudServerIcon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function StorageQuotaModal({ open, onClose }: Props) {
  const [usage, setUsage] = useState<{
    usedBytes: number;
    maxBytes: number;
    filesCount: number;
    trashBytes: number;
    trashCount: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/files/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setUsage(d); })
      .catch(() => {});
  }, [open]);

  const handleUpgrade = async () => {
    window.dispatchEvent(new CustomEvent("securewarp-open-settings", { detail: { tab: "storage" } }));
    onClose();
  };

  if (!open) return null;

  const used = usage?.usedBytes ?? 0;
  const max = usage?.maxBytes ?? 20 * 1024 * 1024 * 1024;
  const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
  const trashBytes = usage?.trashBytes ?? 0;
  const trashCount = usage?.trashCount ?? 0;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-[440px] rounded-2xl bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        {/* Cream header band — eyebrow + storage glyph + headline. */}
        <div className="bg-bg-side px-6 py-7 text-center border-b border-border-tertiary">
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-disabled mb-3">
            Storage limit reached
          </div>
          <div className="w-14 h-14 mx-auto rounded-xl bg-bg-l3 border border-border-tertiary flex items-center justify-center mb-4">
            <HugeiconsIcon icon={CloudServerIcon} size={24} color="var(--accent-red-primary)" />
          </div>
          <div className="text-[16px] font-semibold text-text-primary">Your drive is full</div>
          <div className="text-[12px] text-text-disabled mt-1 max-w-[320px] mx-auto leading-relaxed">
            Free up room by emptying the trash or upgrade for more space.
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] text-text-secondary">
              {formatBytes(used)} of {formatBytes(max)} used
            </span>
            <span className="text-[11px] font-mono text-text-disabled tracking-wider">
              {pct.toFixed(0)}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-bg-field overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                background: pct > 90 ? "var(--accent-red-primary)" : "var(--text-link)",
              }}
            />
          </div>

          {trashBytes > 0 && (
            <div className="flex items-start gap-3 mt-4 p-3 rounded-[10px] bg-accent-yellow-bg border border-accent-yellow/15">
              <div className="w-6 h-6 rounded-[6px] bg-accent-yellow/20 flex items-center justify-center shrink-0 mt-0.5">
                <HugeiconsIcon icon={Delete02Icon} size={13} color="var(--accent-yellow-primary)" />
              </div>
              <div className="text-[12px] text-accent-yellow">
                <p className="font-medium">Trash has {formatBytes(trashBytes)}</p>
                <p className="opacity-75 mt-0.5 leading-relaxed">
                  Emptying it would free that space instantly. {trashCount} {trashCount === 1 ? "file" : "files"} waiting.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 h-[40px] rounded-[10px] bg-bg-field text-text-secondary text-[13px] font-medium hover:bg-bg-cell-hover transition-colors cursor-pointer"
          >
            Close
          </button>
          <button
            onClick={handleUpgrade}
            className="flex-1 h-[40px] rounded-[10px] bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer active:scale-[0.98]"
          >
            Upgrade plan
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
