"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import BugIcon from "@hugeicons/core-free-icons/Bug01Icon";
import Idea01Icon from "@hugeicons/core-free-icons/Idea01Icon";
import MessageMultiple01Icon from "@hugeicons/core-free-icons/MessageMultiple01Icon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";

/**
 * In-app feedback. Anonymous to admins by design: the admin UI never
 * renders email/display name, and the wire format they receive has
 * those fields stripped. The submitter's user_id stays in the DB only
 * for rate-limit accounting.
 */

type Category = "bug" | "idea" | "other";

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES: { id: Category; label: string; icon: typeof BugIcon }[] = [
  { id: "bug", label: "Bug", icon: BugIcon },
  { id: "idea", label: "Idea", icon: Idea01Icon },
  { id: "other", label: "Other", icon: MessageMultiple01Icon },
];

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const [category, setCategory] = useState<Category>("idea");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setCategory("idea");
      setBody("");
      setDone(false);
      setError(null);
      setTimeout(() => textareaRef.current?.focus(), 50);
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, body: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to submit");
        setSubmitting(false);
        return;
      }
      setDone(true);
      setSubmitting(false);
      // Auto-close on success after a beat.
      setTimeout(() => onClose(), 1400);
    } catch {
      setError("Failed to submit");
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Send feedback"
        className="relative w-full h-full md:h-auto max-w-none md:max-w-[460px] mx-0 md:mx-4 rounded-none md:rounded-2xl bg-bg-l3 border-0 md:border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center">
              <HugeiconsIcon icon={MessageMultiple01Icon} size={18} color="var(--accent-green-primary)" />
            </div>
            <span className="text-[14px] font-semibold text-text-primary">Send feedback</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
        </div>

        {/* Body */}
        {done ? (
          <div className="px-5 py-10 flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-green/20 flex items-center justify-center">
              <HugeiconsIcon icon={Tick01Icon} size={20} color="var(--accent-green-primary)" />
            </div>
            <div className="text-[14px] font-medium text-text-primary">Thanks for the note.</div>
            <div className="text-[12px] text-text-tertiary text-center max-w-[320px]">
              It went straight to our team. Anonymous by design.
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="px-5 py-5">
            {/* Category */}
            <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">
              Category
            </label>
            <div className="flex gap-2 mb-4">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 h-[36px] rounded-[8px] text-[12px] font-medium transition-colors cursor-pointer ${
                    category === c.id
                      ? "bg-cta-primary text-text-inverse"
                      : "bg-bg-field text-text-secondary hover:bg-cta-secondary-hover"
                  }`}
                >
                  <HugeiconsIcon icon={c.icon} size={14} />
                  {c.label}
                </button>
              ))}
            </div>

            {/* Body */}
            <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">
              Your feedback
            </label>
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, 2000))}
              placeholder="Tell us what's on your mind. Bugs, ideas, anything."
              rows={6}
              className="w-full px-3.5 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40 resize-none"
            />
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-[11px] text-text-disabled">Sent anonymously to our team.</p>
              <p className="text-[11px] text-text-disabled font-mono">{body.length}/2000</p>
            </div>

            {error && <p className="text-[12px] text-accent-red mt-3">{error}</p>}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={onClose}
                className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!body.trim() || submitting}
                className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Sending…" : "Send feedback"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
