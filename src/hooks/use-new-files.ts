"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * NEW-badge tracker. Shows a small pill on recently-uploaded or
 * recently-shared files. A file is considered "new" when:
 *   1. Its created_at is within NEW_WINDOW_MS of now, AND
 *   2. The user hasn't interacted with it yet.
 *
 * Interaction = preview, download, rename, move, star, share —
 * basically anything that signals "I know this file exists." The
 * first interaction dismisses the badge immediately.
 *
 * Storage: localStorage, per-browser. No server round-trip. If you
 * open a file on laptop the badge still shows for a bit on phone
 * until the 24h window closes — acceptable for an MVP; promote to
 * a server per-user seen_at column later if users complain.
 *
 * Concurrency model: every write reads the current localStorage
 * before saving and keeps the EARLIER of the two timestamps per id.
 * This means a second tab, a remounted hook (post-deploy HMR, React
 * StrictMode), or any other concurrent writer cannot clobber
 * dismiss-marks written elsewhere. We also subscribe to the browser
 * `storage` event so cross-tab markSeen calls sync into React state
 * without requiring a refresh — the previous behaviour silently
 * dropped writes when two tabs raced.
 *
 * Garbage collection: on hook init (and on storage events) we drop
 * any tracked IDs older than NEW_WINDOW_MS * 2 so localStorage
 * doesn't grow unboundedly.
 */

const STORAGE_KEY = "securewarp_seen_files_v1";
const NEW_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

type SeenMap = Record<string, number>; // fileId -> epoch ms when marked seen

function readRaw(): SeenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SeenMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    // Parse errors = corrupted blob. Log once so we notice if it
    // happens in the wild; return empty so the badge UI still
    // functions (just shows NEW on files that should already be
    // dismissed, which is cosmetic).
    if (typeof console !== "undefined") console.warn("useNewFiles: loadSeen failed", err);
    return {};
  }
}

function loadSeen(): SeenMap {
  const raw = readRaw();
  // Garbage collect entries older than 2× the NEW window — anything
  // older can't affect isNew() and just eats storage.
  const now = Date.now();
  const cleaned: SeenMap = {};
  for (const [id, ts] of Object.entries(raw)) {
    if (typeof ts === "number" && now - ts < NEW_WINDOW_MS * 2) {
      cleaned[id] = ts;
    }
  }
  return cleaned;
}

function persistMerge(updates: SeenMap): SeenMap {
  // Read the current disk state BEFORE writing and merge. Keeps the
  // EARLIER timestamp per id so later writers never rewind a dismiss.
  // This is the critical fix for the post-deploy / multi-tab bug:
  // without the re-read, a remounted hook with fresh `{}` state
  // would stomp entries that were written before the remount.
  if (typeof window === "undefined") return updates;
  try {
    const current = readRaw();
    const merged: SeenMap = { ...current };
    for (const [id, ts] of Object.entries(updates)) {
      const existing = merged[id];
      merged[id] = existing ? Math.min(existing, ts) : ts;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch (err) {
    // Quota exceeded or storage disabled. Log once so we notice.
    if (typeof console !== "undefined") console.warn("useNewFiles: saveSeen failed", err);
    return updates;
  }
}

export function useNewFiles() {
  // Lazy init from localStorage so the very first render already
  // reflects previously-seen items. Using useEffect to hydrate was
  // racy: first render showed the badge with an empty seen map, and
  // if the user clicked before the effect fired, markSeen would write
  // a seen map built from the empty state — stomping any other entries
  // that hadn't loaded yet. Since the hook is only called inside
  // `"use client"` trees, running this on first render is safe.
  const [seen, setSeen] = useState<SeenMap>(() => loadSeen());

  const markSeen = useCallback((fileId: string) => {
    setSeen((prev) => {
      if (prev[fileId]) return prev;
      const persisted = persistMerge({ ...prev, [fileId]: Date.now() });
      return persisted;
    });
  }, []);

  const markManySeen = useCallback((fileIds: string[]) => {
    setSeen((prev) => {
      const now = Date.now();
      let changed = false;
      const next: SeenMap = { ...prev };
      for (const id of fileIds) {
        if (!next[id]) {
          next[id] = now;
          changed = true;
        }
      }
      if (!changed) return prev;
      return persistMerge(next);
    });
  }, []);

  // Mark-seen on folder-open events dispatched from use-files.ts. Any
  // code path that navigates into a folder (row click, keyboard Enter,
  // context menu "Open", drag-hover, etc.) goes through
  // `navigateToFolder`, which fires this event. Consolidates the
  // dismiss logic so the badge dies on navigation regardless of which
  // click handler started it.
  useEffect(() => {
    const onOpened = (e: Event) => {
      const detail = (e as CustomEvent<{ fileId?: string }>).detail;
      if (detail?.fileId) markSeen(detail.fileId);
    };
    window.addEventListener("securewarp-file-opened", onOpened);
    return () => window.removeEventListener("securewarp-file-opened", onOpened);
  }, [markSeen]);

  // Cross-tab sync. If another tab marked a file seen, pull its
  // write into our state so the badge disappears here too. Without
  // this, two tabs each hold stale React state and writes clobber
  // each other on disk (the merge on save prevents the clobber;
  // this listener is what makes the UI reflect the merged truth).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setSeen(loadSeen());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const isNew = useCallback(
    (fileId: string, createdAtIso: string | null | undefined): boolean => {
      if (!createdAtIso) return false;
      if (seen[fileId]) return false;
      const createdAt = new Date(createdAtIso).getTime();
      if (Number.isNaN(createdAt)) return false;
      return Date.now() - createdAt < NEW_WINDOW_MS;
    },
    [seen],
  );

  return useMemo(
    () => ({ isNew, markSeen, markManySeen }),
    [isNew, markSeen, markManySeen],
  );
}
