"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import RefreshIcon from "@hugeicons/core-free-icons/Refresh01Icon";
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
import { useVersionCheck } from "@/hooks/use-version-check";

/**
 * "New version available" strip. Sits in the same slot as the
 * announcement banner. Two visual states:
 *
 *   - soft (info blue): a deploy was detected via polling. User
 *     can finish their current task (upload, edit) then click
 *     Reload. No dismiss button — letting it disappear would
 *     leave the user wondering why a chunk later 404's.
 *   - hard (warning yellow): a dynamic import already failed with
 *     ChunkLoadError, so the running bundle is degraded. We stop
 *     short of forcing a reload because that would silently kill
 *     an in-flight upload — the user is the right person to
 *     decide when it's safe.
 */
export function UpdateBanner() {
  const status = useVersionCheck();
  if (status === "ok") return null;

  const isHard = status === "hard";
  const styles = isHard
    ? {
        bg: "color-mix(in srgb, var(--accent-yellow-primary) 12%, transparent)",
        border: "color-mix(in srgb, var(--accent-yellow-primary) 28%, transparent)",
        icon: "var(--accent-yellow-primary)",
      }
    : {
        bg: "var(--bg-overlay-tertiary)",
        border: "var(--border-tertiary)",
        icon: "var(--accent-blue-primary)",
      };

  const title = isHard ? "Update required" : "A new version is available";
  const body = isHard
    ? "Some parts of the app failed to load. Reload when you're ready to apply the update."
    : "Reload to apply the latest changes. Finish anything in progress first.";

  return (
    <div className="shrink-0 p-1.5 pb-0 bg-bg-main">
      <div
        className="flex items-center gap-3 px-4 py-2.5 rounded-[10px]"
        style={{ background: styles.bg, border: `1px solid ${styles.border}` }}
      >
        <HugeiconsIcon
          icon={isHard ? Alert02Icon : InformationCircleIcon}
          size={16}
          color={styles.icon}
          className="shrink-0"
        />
        <div className="flex-1 min-w-0 text-[13px] leading-[1.5] whitespace-pre-wrap break-words">
          <span className="font-semibold text-text-primary">{title}</span>
          <span className="text-text-secondary"> — {body}</span>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium text-text-primary bg-cta-nav-hover hover:bg-bg-overlay-secondary transition-colors cursor-pointer"
        >
          <HugeiconsIcon icon={RefreshIcon} size={12} />
          Reload
        </button>
      </div>
    </div>
  );
}
