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
 * Garbage collection: on hook init we drop any tracked IDs older
 * than NEW_WINDOW_MS so localStorage doesn't grow unboundedly.
 */

const STORAGE_KEY = "securewarp_seen_files_v1";
const NEW_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

type SeenMap = Record<string, number>; // fileId -> epoch ms when marked seen

function loadSeen(): SeenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SeenMap;
    // Garbage collect entries older than the window — they don't
    // need to be tracked anymore because the file wouldn't be new
    // anyway.
    const now = Date.now();
    const cleaned: SeenMap = {};
    for (const [id, ts] of Object.entries(parsed)) {
      if (typeof ts === "number" && now - ts < NEW_WINDOW_MS * 2) {
        cleaned[id] = ts;
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}

function saveSeen(seen: SeenMap) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  } catch { /* quota; silently drop */ }
}

export function useNewFiles() {
  const [seen, setSeen] = useState<SeenMap>({});
  // Hydrate on mount only — SSR returns {} to avoid hydration
  // mismatch on the server/client boundary.
  useEffect(() => {
    setSeen(loadSeen());
  }, []);

  const markSeen = useCallback((fileId: string) => {
    setSeen((prev) => {
      if (prev[fileId]) return prev;
      const next = { ...prev, [fileId]: Date.now() };
      saveSeen(next);
      return next;
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
      saveSeen(next);
      return next;
    });
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
