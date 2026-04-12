"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Edit02Icon from "@hugeicons/core-free-icons/Edit02Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import type { DecryptedFile } from "@/hooks/use-files";

interface RenameModalProps {
  file: DecryptedFile | null;
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
}

export function RenameModal({
  file,
  value,
  onChange,
  busy,
  error,
  onClose,
  onSubmit,
}: RenameModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) return;
    // Autofocus and pre-select the basename (stop at the last dot)
    // so typing immediately replaces it without clobbering the
    // extension. Users renaming "report.pdf" almost always want
    // "NewName.pdf", not "NewName".
    const t = setTimeout(() => {
      inputRef.current?.focus();
      const el = inputRef.current;
      if (el && value) {
        const lastDot = value.lastIndexOf(".");
        const end = lastDot > 0 ? lastDot : value.length;
        el.setSelectionRange(0, end);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!file) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [file, onClose, busy]);

  if (!file) return null;

  const disabled = busy || value.trim().length === 0 || value.trim() === file.name;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in"
        onClick={() => !busy && onClose()}
      />
      <div
        className="relative w-full h-full md:h-auto max-w-none md:max-w-[420px] mx-0 md:mx-4 rounded-none md:rounded-2xl bg-bg-l3 border-0 md:border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center">
              <HugeiconsIcon icon={Edit02Icon} size={18} color="var(--accent-blue-primary)" />
            </div>
            <span className="text-[14px] font-semibold text-text-primary">
              Rename {file.isFolder ? "folder" : "file"}
            </span>
          </div>
          {!busy && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={16} />
            </button>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!disabled) onSubmit();
          }}
          className="px-5 py-5"
        >
          <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">
            Name
          </label>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={busy}
            className="w-full px-3.5 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40 disabled:opacity-50"
          />

          {error && (
            <div className="mt-3 p-2.5 rounded-lg bg-accent-red/10 border border-accent-red/20 text-[12px] text-accent-red">
              {error}
            </div>
          )}

          <div className="flex items-center gap-1.5 mt-4 text-[11px] text-text-disabled">
            <HugeiconsIcon icon={LockIcon} size={12} />
            Re-encrypted locally. The server never sees the new name.
          </div>

          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={disabled}
              className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              {busy ? "Renaming…" : "Rename"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
