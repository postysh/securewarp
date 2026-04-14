"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";

type Severity = "info" | "warning" | "critical";

type Announcement = {
  id: string;
  title: string;
  body: string;
  severity: Severity;
};

/**
 * Dismissible strip at the top of the drive.
 *
 * Shows one announcement at a time as a carousel. Server caps the list
 * at 3 (newest-first). Left/right arrows and a position indicator
 * appear when there's more than one active announcement. Dismissing
 * the visible one persists a server-side dismissal and auto-advances
 * (or hides the strip if it was the last).
 */
export function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    fetch("/api/announcements/active")
      .then((r) => (r.ok ? r.json() : { announcements: [] }))
      .then((d) => setItems(d.announcements ?? []))
      .catch(() => setItems([]));
  }, []);

  const current = items && items.length > 0 ? items[Math.min(index, items.length - 1)] : null;

  const dismiss = async () => {
    if (!current) return;
    // Optimistic: drop it locally immediately. Server is source of truth
    // so a failed POST just means the banner re-appears next page load.
    const id = current.id;
    setItems((curr) => {
      if (!curr) return curr;
      const next = curr.filter((a) => a.id !== id);
      // Keep the displayed index valid: if we dismissed the last item
      // in the list, step back one so the previous one becomes visible.
      setIndex((i) => Math.min(i, Math.max(next.length - 1, 0)));
      return next;
    });
    try {
      await fetch(`/api/announcements/${id}/dismiss`, { method: "POST" });
    } catch {
      /* swallow */
    }
  };

  if (!items || items.length === 0 || !current) return null;

  const styles = severityStyle(current.severity);
  const total = items.length;
  const hasMultiple = total > 1;

  return (
    <div className="shrink-0 p-1.5 border-b border-border-secondary bg-bg-main">
      <div
        className="flex items-center gap-3 px-4 py-2.5 rounded-[10px]"
        style={{ background: styles.bg, border: `1px solid ${styles.border}` }}
      >
        <HugeiconsIcon
          icon={current.severity === "info" ? InformationCircleIcon : Alert02Icon}
          size={16}
          color={styles.icon}
          className="shrink-0"
        />
        <div className="flex-1 min-w-0 text-[13px] leading-[1.5] whitespace-pre-wrap break-words">
          <span className="font-semibold text-text-primary">{current.title}</span>
          <span className="text-text-secondary"> — {current.body}</span>
        </div>

        {/* Carousel controls — only render when there's something to
            navigate through. Position indicator sits between arrows
            so the user always knows where they are in the queue. */}
        {hasMultiple && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setIndex((i) => (i - 1 + total) % total)}
              aria-label="Previous announcement"
              className="p-1 rounded-md text-icon-tertiary hover:text-text-primary hover:bg-cta-nav-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={13} />
            </button>
            <span className="text-[11px] font-mono text-text-tertiary tabular-nums min-w-[28px] text-center">
              {index + 1}/{total}
            </span>
            <button
              onClick={() => setIndex((i) => (i + 1) % total)}
              aria-label="Next announcement"
              className="p-1 rounded-md text-icon-tertiary hover:text-text-primary hover:bg-cta-nav-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={ArrowRight01Icon} size={13} />
            </button>
          </div>
        )}

        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 p-1 rounded-md text-icon-tertiary hover:text-text-primary hover:bg-cta-nav-hover transition-colors cursor-pointer"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} />
        </button>
      </div>
    </div>
  );
}

function severityStyle(s: Severity) {
  switch (s) {
    case "critical":
      return {
        bg: "color-mix(in srgb, var(--accent-red-primary) 10%, transparent)",
        border: "color-mix(in srgb, var(--accent-red-primary) 25%, transparent)",
        icon: "var(--accent-red-primary)",
      };
    case "warning":
      return {
        bg: "color-mix(in srgb, var(--accent-yellow-primary) 12%, transparent)",
        border: "color-mix(in srgb, var(--accent-yellow-primary) 28%, transparent)",
        icon: "var(--accent-yellow-primary)",
      };
    case "info":
    default:
      return {
        bg: "var(--bg-overlay-tertiary)",
        border: "var(--border-tertiary)",
        icon: "var(--accent-blue-primary)",
      };
  }
}
