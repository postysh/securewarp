"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Key02Icon from "@hugeicons/core-free-icons/Key02Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import Alert01Icon from "@hugeicons/core-free-icons/Alert01Icon";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import ViewOffIcon from "@hugeicons/core-free-icons/ViewOffIcon";

interface RecoveryKeyModalProps {
  open: boolean;
  onClose: () => void;
  recoveryKey?: string;
}

function downloadRecoveryFile(recoveryKey: string) {
  const content = [
    "SECUREWARP RECOVERY KEY",
    "=======================",
    "",
    "Keep this somewhere safe. If you lose your password,",
    "this is the ONLY way to recover your encrypted files.",
    "",
    "Recovery phrase (paste this entire line to recover):",
    "",
    recoveryKey,
    "",
    "=======================",
    `Generated: ${new Date().toISOString()}`,
    "IMPORTANT: Store offline. Do not share.",
  ].join("\n");

  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "securewarp-recovery-key.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function RecoveryKeyModal({ open, onClose, recoveryKey }: RecoveryKeyModalProps) {
  const words = recoveryKey ? recoveryKey.split(" ") : [];
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

  const handleCopy = () => {
    if (recoveryKey) {
      navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (recoveryKey) {
      downloadRecoveryFile(recoveryKey);
      setDownloaded(true);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" />

      <div
        className="relative w-full max-w-[520px] rounded-2xl bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        {/* Cream header band — eyebrow + key icon tile + headline. */}
        <div className="bg-bg-side px-6 py-7 text-center border-b border-border-tertiary">
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-disabled mb-3">
            One-time setup
          </div>
          <div className="w-14 h-14 mx-auto rounded-xl bg-bg-l3 border border-border-tertiary flex items-center justify-center mb-4">
            <HugeiconsIcon icon={Key02Icon} size={24} color="var(--text-link)" />
          </div>
          <div className="text-[16px] font-semibold text-text-primary">Your recovery phrase</div>
          <div className="text-[12px] text-text-disabled mt-1 max-w-[360px] mx-auto leading-relaxed">
            24 words. Your second path in if you ever lose your password.
          </div>
        </div>

        <div className="px-6 py-6">
          {/* Warning card — warm amber tint on the surface + icon, but
              the copy stays on text-primary for readable contrast in
              both themes. Light-mode amber-on-amber was washing out. */}
          <div className="flex items-start gap-3 p-3.5 rounded-[10px] bg-accent-yellow-bg border border-accent-yellow/15 text-[12px] text-text-primary mb-5">
            <div className="w-6 h-6 rounded-[6px] bg-accent-yellow/20 flex items-center justify-center shrink-0 mt-0.5 text-accent-yellow">
              <HugeiconsIcon icon={Alert01Icon} size={13} />
            </div>
            <div>
              <p className="font-medium">Store this somewhere offline</p>
              <p className="text-text-secondary mt-0.5 leading-relaxed">
                We never see it and cannot reset it. Lose this and your
                password, and your encrypted files are gone for good.
              </p>
            </div>
          </div>

          {/* Recovery phrase — blurred by default, revealed on tap. */}
          <div className="relative rounded-[12px] border border-border-tertiary bg-bg-side overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-border-tertiary">
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-disabled">
                {words.length} words
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setIsBlurred(!isBlurred)}
                  className="flex items-center gap-1.5 h-[26px] px-2 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
                >
                  <HugeiconsIcon icon={isBlurred ? ViewIcon : ViewOffIcon} size={12} />
                  {isBlurred ? "Reveal" : "Hide"}
                </button>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 h-[26px] px-2 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
                >
                  <HugeiconsIcon icon={Copy01Icon} size={12} />
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <div
              className="p-4 transition-all duration-200 min-h-[96px]"
              style={{ filter: isBlurred ? "blur(5px)" : "none" }}
            >
              <p className="text-[13px] leading-relaxed font-mono select-all break-words text-text-primary">
                {recoveryKey}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between mt-5">
            <button
              onClick={handleDownload}
              className="h-[36px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <HugeiconsIcon icon={Download04Icon} size={14} />
              {downloaded ? "Downloaded" : "Download .txt"}
            </button>
            <button
              onClick={onClose}
              className="h-[36px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer active:scale-[0.98]"
            >
              I have saved my phrase
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
