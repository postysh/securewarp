"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Flag01Icon from "@hugeicons/core-free-icons/Flag01Icon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";

/**
 * Authenticated report dialog for files shared with the current user.
 * Submits to POST /api/abuse/report with `fileId`. The server gates on
 * the reporter having some access claim (a direct file_keys row or an
 * inherited grant), so callers can't spam-report random ids.
 */

type Category = "csam" | "harassment" | "malware" | "copyright" | "illegal" | "other";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "csam", label: "Child sexual abuse material (CSAM)" },
  { value: "harassment", label: "Harassment or targeted abuse" },
  { value: "malware", label: "Malware, phishing, or scam" },
  { value: "copyright", label: "Copyright infringement" },
  { value: "illegal", label: "Other illegal content" },
  { value: "other", label: "Something else" },
];

interface ReportFileModalProps {
  open: boolean;
  fileId: string | null;
  fileName?: string;
  onClose: () => void;
}

export function ReportFileModal({
  open,
  fileId,
  fileName,
  onClose,
}: ReportFileModalProps) {
  const [category, setCategory] = useState<Category>("csam");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setCategory("csam");
      setDetails("");
      setDone(false);
      setError(null);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, submitting]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fileId || submitting) return;
    const trimmed = details.trim();
    if (trimmed.length < 10) {
      setError("Please describe the issue in at least 10 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/abuse/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, category, details: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        setError((data as { error?: string }).error ?? "Failed to submit");
        setSubmitting(false);
        return;
      }
      setDone(true);
      setSubmitting(false);
      setTimeout(() => onClose(), 1400);
    } catch {
      setError("Failed to submit");
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in"
        onClick={() => !submitting && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Report this file"
        className="relative w-full h-full md:h-auto max-w-none md:max-w-[460px] mx-0 md:mx-4 rounded-none md:rounded-2xl bg-bg-l3 border-0 md:border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center">
              <HugeiconsIcon icon={Flag01Icon} size={16} color="var(--accent-red-primary)" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[14px] font-semibold text-text-primary">Report this file</span>
              {fileName && (
                <span className="text-[11px] text-text-disabled truncate max-w-[300px]">
                  {fileName}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => !submitting && onClose()}
            className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer disabled:opacity-50"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
        </div>

        {done ? (
          <div className="px-5 py-10 flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-green/20 flex items-center justify-center">
              <HugeiconsIcon icon={Tick01Icon} size={20} color="var(--accent-green-primary)" />
            </div>
            <div className="text-[14px] font-medium text-text-primary">Report received</div>
            <div className="text-[12px] text-text-tertiary text-center max-w-[320px]">
              Our trust and safety team will review this report.
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="px-5 py-5">
            <p className="text-[11px] text-text-tertiary leading-relaxed mb-4">
              SecureWarp stores files encrypted. We cannot read the contents. Your report helps our team take action on the file, the share, and the uploader.
            </p>

            <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              disabled={submitting}
              className="w-full px-3.5 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-red/25 border border-transparent focus:border-accent-red/40 mb-4 disabled:opacity-60"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>

            <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">
              What is the issue?
            </label>
            <textarea
              ref={textareaRef}
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, 2000))}
              placeholder="Describe what you saw, include context that helps us act quickly."
              rows={5}
              className="w-full px-3.5 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-red/25 border border-transparent focus:border-accent-red/40 resize-none"
            />
            <div className="flex items-center justify-end mt-1.5">
              <p className="text-[11px] text-text-disabled font-mono">{details.length}/2000</p>
            </div>

            {error && <p className="text-[12px] text-accent-red mt-3">{error}</p>}

            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => !submitting && onClose()}
                disabled={submitting}
                className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || details.trim().length < 10}
                className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
