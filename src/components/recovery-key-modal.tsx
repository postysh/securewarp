"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Key02Icon from "@hugeicons/core-free-icons/Key02Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import Alert01Icon from "@hugeicons/core-free-icons/Alert01Icon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import ViewOffIcon from "@hugeicons/core-free-icons/ViewOffIcon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";

interface RecoveryKeyModalProps {
  open: boolean;
  onClose: () => void;
}

// Mock recovery key (would be generated client-side in production)
const MOCK_RECOVERY_KEY = "whale guitar ocean marble thunder silk valley prism delta forge ember crystal noble flame quest lunar spark grove frost atlas";

export function RecoveryKeyModal({ open, onClose }: RecoveryKeyModalProps) {
  const [isBlurred, setIsBlurred] = useState(true);
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    if (open) {
      setIsBlurred(true);
      setCopied(false);
      setDownloaded(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleCopy = () => {
    navigator.clipboard.writeText(MOCK_RECOVERY_KEY);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    setDownloaded(true);
    // Would generate and download a PDF in production
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div
        className="relative w-full max-w-[480px] mx-4 rounded-2xl bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center">
              <HugeiconsIcon icon={Key02Icon} size={18} color="var(--accent-yellow-primary)" />
            </div>
            <span className="text-[14px] font-semibold text-text-primary">Recovery Key</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer">
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {/* Warning */}
          <div className="flex items-start gap-3 p-3.5 rounded-[10px] bg-accent-yellow-bg border border-accent-yellow/10 text-[12px] text-accent-yellow mb-5">
            <div className="w-6 h-6 rounded-[6px] bg-accent-yellow/15 flex items-center justify-center shrink-0 mt-0.5">
              <HugeiconsIcon icon={Alert01Icon} size={13} />
            </div>
            <div>
              <p className="font-medium">Save this key somewhere safe</p>
              <p className="opacity-70 mt-0.5 leading-relaxed">If you lose your password and this key, your files are permanently unrecoverable. We cannot reset this for you.</p>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2 mb-5">
            <div className="flex items-center gap-2 text-[12px] text-text-secondary">
              <HugeiconsIcon icon={Key02Icon} size={14} color="var(--icon-tertiary)" />
              <span>Download or copy your one-time recovery code</span>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-text-secondary">
              <HugeiconsIcon icon={LockIcon} size={14} color="var(--icon-tertiary)" />
              <span>This key can decrypt your private keys if you forget your password</span>
            </div>
          </div>

          {/* Key card */}
          <div className="relative rounded-[10px] bg-bg-overlay-tertiary overflow-hidden min-h-[100px]">
            <div
              className="p-4 transition-all duration-200"
              style={{ filter: isBlurred ? "blur(5px)" : "none" }}
            >
              <p className={`text-[13px] leading-relaxed font-mono select-all ${isBlurred ? "text-text-disabled" : "text-text-secondary"}`}>
                {MOCK_RECOVERY_KEY}
              </p>
            </div>

            {/* Key actions — bottom right */}
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              <button
                onClick={() => setIsBlurred(!isBlurred)}
                className="flex items-center gap-1.5 h-[28px] px-2.5 rounded-[6px] text-[11px] font-medium text-text-secondary bg-bg-l3 hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={isBlurred ? ViewIcon : ViewOffIcon} size={12} />
                {isBlurred ? "Reveal" : "Hide"}
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 h-[28px] px-2.5 rounded-[6px] text-[11px] font-medium text-text-secondary bg-bg-l3 hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={Copy01Icon} size={12} />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              onClick={onClose}
              className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={handleDownload}
              className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] flex items-center gap-1.5"
            >
              <HugeiconsIcon icon={Download04Icon} size={14} />
              {downloaded ? "Downloaded" : "Save key as PDF"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
