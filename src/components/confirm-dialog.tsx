"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import AlertDiamondIcon from "@hugeicons/core-free-icons/AlertDiamondIcon";

/**
 * Themed confirmation dialog — replaces the browser native `confirm()`.
 * Used for destructive / irreversible actions (securely revoking a
 * collaborator, rotating folder keys, deleting files, etc).
 *
 * Usage pattern:
 *   1. Parent renders `<ConfirmDialog open onConfirm onCancel ... />`
 *      conditionally based on its own state
 *   2. Optionally drives a loading state on the confirm button via
 *      the `busy` prop so the dialog can stay visible while the
 *      destructive action is in flight
 *
 * Keyboard: Esc cancels, Enter confirms (when not busy). Backdrop
 * click cancels unless `busy` is true (prevents closing mid-action).
 */
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  // Either a simple string for the body or arbitrary React nodes for
  // richer content (multi-paragraph warnings, bullet lists, etc).
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  // When true, the confirm button turns red (destructive action).
  destructive?: boolean;
  // When true, the dialog shows a spinner on the confirm button and
  // blocks closing via Esc / backdrop.
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  busyLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") {
        e.preventDefault();
        void onConfirm();
      }
    };
    document.addEventListener("keydown", handler);
    // Auto-focus the confirm button so Enter works immediately. Doing
    // this inside the effect (not a ref autoFocus) ensures the button
    // exists in the DOM when we try to focus it.
    setTimeout(() => confirmBtnRef.current?.focus(), 30);
    return () => document.removeEventListener("keydown", handler);
  }, [open, busy, onConfirm, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-[440px] mx-4 rounded-2xl bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0 ${
                destructive ? "bg-accent-red/10" : "bg-bg-overlay-tertiary"
              }`}
            >
              <HugeiconsIcon
                icon={AlertDiamondIcon}
                size={18}
                color={
                  destructive
                    ? "var(--accent-red-primary)"
                    : "var(--accent-yellow-primary)"
                }
              />
            </div>
            <span
              id="confirm-dialog-title"
              className="text-[14px] font-semibold text-text-primary truncate"
            >
              {title}
            </span>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          <div className="text-[12px] text-text-secondary leading-relaxed whitespace-pre-wrap">
            {description}
          </div>

          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              onClick={onCancel}
              disabled={busy}
              className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmBtnRef}
              onClick={() => void onConfirm()}
              disabled={busy}
              className={`h-[34px] px-4 rounded-[8px] text-[12px] font-medium transition-all cursor-pointer active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed ${
                destructive
                  ? "bg-accent-red text-white hover:opacity-90"
                  : "bg-cta-primary text-text-inverse hover:opacity-90"
              }`}
            >
              {busy ? busyLabel ?? "Working…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
