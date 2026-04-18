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
    // Billing is mid-integration (Stripe). Route the user to
    // Settings → Plan & billing where the checkout UI will live
    // once wired.
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-[420px] mx-4 rounded-2xl bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        <div className="px-6 pt-6 pb-2">
          <div className="w-12 h-12 rounded-[12px] bg-accent-red/12 flex items-center justify-center mb-4">
            <HugeiconsIcon icon={CloudServerIcon} size={22} color="var(--accent-red-primary)" />
          </div>
          <h2 className="text-[18px] font-semibold text-text-primary tracking-[-0.02em] mb-1">
            Storage full
          </h2>
          <p className="text-text-secondary text-[13px] leading-relaxed mb-5">
            Your upload could not be completed because your storage is full.
            Free up space by deleting files or emptying your trash.
          </p>
        </div>

        {/* Usage bar */}
        <div className="px-6 pb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] text-text-secondary">
              {formatBytes(used)} of {formatBytes(max)} used
            </span>
            <span className="text-[12px] font-mono text-text-disabled">
              {pct.toFixed(0)}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-bg-field overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                background: pct > 90 ? "var(--accent-red-primary)" : "var(--accent-green-primary)",
              }}
            />
          </div>

          {trashBytes > 0 && (
            <div className="flex items-center gap-2 mt-3 p-2.5 rounded-lg bg-accent-yellow-bg">
              <HugeiconsIcon icon={Delete02Icon} size={14} color="var(--accent-yellow-primary)" />
              <span className="text-[12px] text-text-secondary">
                {formatBytes(trashBytes)} in trash ({trashCount} {trashCount === 1 ? "file" : "files"}).
                Emptying it would free that space.
              </span>
            </div>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 h-[38px] rounded-[10px] bg-bg-field text-text-secondary text-[13px] font-medium hover:bg-bg-cell-hover transition-colors cursor-pointer"
          >
            Close
          </button>
          <button
            onClick={handleUpgrade}
            className="flex-1 h-[38px] rounded-[10px] bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer"
          >
            Upgrade plan
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
