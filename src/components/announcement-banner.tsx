"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";

type Severity = "info" | "warning" | "critical";

type Announcement = {
  id: string;
  title: string;
  body: string;
  severity: Severity;
};

/**
 * Dismissible strip rendered at the top of the drive. Shows every
 * published, not-yet-expired, not-yet-dismissed announcement for the
 * current user. Click the ✕ to persist a dismissal; the server remembers
 * it so the announcement won't reappear on other devices either.
 *
 * If there's more than one live announcement, they stack — most
 * recent at the top (the active endpoint already sorts by published_at
 * desc).
 */
export function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[] | null>(null);

  useEffect(() => {
    fetch("/api/announcements/active")
      .then((r) => (r.ok ? r.json() : { announcements: [] }))
      .then((d) => setItems(d.announcements ?? []))
      .catch(() => setItems([]));
  }, []);

  const dismiss = async (id: string) => {
    // Optimistic — hide immediately even if the POST is slow. If the
    // request fails, we re-show on next page load (no corrupt state
    // because the server is the source of truth).
    setItems((curr) => (curr ? curr.filter((a) => a.id !== id) : curr));
    try {
      await fetch(`/api/announcements/${id}/dismiss`, { method: "POST" });
    } catch {
      /* swallow — see above */
    }
  };

  if (!items || items.length === 0) return null;

  return (
    <div className="shrink-0 flex flex-col gap-1 p-1.5 border-b border-border-secondary bg-bg-main">
      {items.map((a) => (
        <BannerRow key={a.id} item={a} onDismiss={() => dismiss(a.id)} />
      ))}
    </div>
  );
}

function BannerRow({ item, onDismiss }: { item: Announcement; onDismiss: () => void }) {
  const styles = severityStyle(item.severity);

  return (
    <div
      className="flex items-start gap-3 px-4 py-2.5 rounded-[10px]"
      style={{ background: styles.bg, border: `1px solid ${styles.border}` }}
    >
      <HugeiconsIcon
        icon={item.severity === "info" ? InformationCircleIcon : Alert02Icon}
        size={16}
        color={styles.icon}
        className="mt-0.5 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-text-primary">{item.title}</div>
        <div className="text-[12px] text-text-secondary whitespace-pre-wrap break-words mt-0.5">
          {item.body}
        </div>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 p-1 rounded-md text-icon-tertiary hover:text-text-primary hover:bg-cta-nav-hover transition-colors cursor-pointer"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={13} />
      </button>
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
