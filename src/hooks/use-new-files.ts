"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * NEW-badge tracker. Shows a small pill on recently-uploaded or
 * recently-shared files. A file is considered "new" when:
 *   1. Its created_at is within NEW_WINDOW_MS of now, AND
 *   2. The user hasn't acknowledged it on any device yet.
 *
 * Acknowledgement = preview, download, rename, move, star, share —
 * basically anything that signals "I know this file exists." The
 * first interaction dismisses the badge immediately.
 *
 * **Storage model (two layers):**
 *
 * 1. **Server** — `user_file_seen` table, keyed by (user_id, file_id).
 *    Authoritative. The server hydrates `seenAt` on every file in the
 *    list response, so when a user switches browser or device the
 *    badge stays dismissed on every file they've already opened.
 *
 * 2. **localStorage (optimistic cache)** — same shape as before, still
 *    used so the dismiss happens instantly (no network round-trip
 *    before the badge disappears) and still works offline. On mount
 *    we reconcile with the server state by merging the EARLIEST
 *    timestamp per id — never rewind a dismiss.
 *
 * **Write path:** `markSeen` writes to local state immediately, then
 * batches fire-and-forget POSTs to `/api/files/seen`. A 300 ms debounce
 * coalesces the "open folder → render 50 rows → auto-dismiss" burst
 * into a single request.
 *
 * Concurrency model: every local write reads the current localStorage
 * before saving and keeps the EARLIER of the two timestamps per id.
 * This means a second tab, a remounted hook (post-deploy HMR, React
 * StrictMode), or any other concurrent writer cannot clobber
 * dismiss-marks written elsewhere. We also subscribe to the browser
 * `storage` event so cross-tab markSeen calls sync into React state
 * without requiring a refresh.
 *
 * Garbage collection: on hook init (and on storage events) we drop
 * any tracked IDs older than NEW_WINDOW_MS * 2 so localStorage
 * doesn't grow unboundedly.
 */

const STORAGE_KEY = "securewarp_seen_files_v1";
const NEW_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const FLUSH_DEBOUNCE_MS = 300;

type SeenMap = Record<string, number>; // fileId -> epoch ms when marked seen

function readRaw(): SeenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SeenMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    if (typeof console !== "undefined") console.warn("useNewFiles: loadSeen failed", err);
    return {};
  }
}

function loadSeen(): SeenMap {
  const raw = readRaw();
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
    if (typeof console !== "undefined") console.warn("useNewFiles: saveSeen failed", err);
    return updates;
  }
}

export function useNewFiles() {
  const [seen, setSeen] = useState<SeenMap>(() => loadSeen());

  // Pending server-sync queue. Coalesced with a short debounce so a
  // rapid burst of markSeen calls (opening a folder full of new rows)
  // hits the server as one request rather than N.
  const pendingRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushNow = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const ids = Array.from(pendingRef.current);
    if (ids.length === 0) return;
    pendingRef.current = new Set();
    // Fire-and-forget. On failure we don't retry; the local cache
    // already holds the dismiss, and the next successful mark-seen
    // on the same file will re-try anyway. Worst case: a failed
    // sync + cleared localStorage = the badge reappears on another
    // device, matching today's behavior.
    fetch("/api/files/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileIds: ids }),
      keepalive: true,
    }).catch(() => { /* swallow */ });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flushNow, FLUSH_DEBOUNCE_MS);
  }, [flushNow]);

  const enqueueServer = useCallback((fileId: string) => {
    pendingRef.current.add(fileId);
    scheduleFlush();
  }, [scheduleFlush]);

  const markSeen = useCallback((fileId: string) => {
    setSeen((prev) => {
      if (prev[fileId]) return prev;
      const persisted = persistMerge({ ...prev, [fileId]: Date.now() });
      return persisted;
    });
    enqueueServer(fileId);
  }, [enqueueServer]);

  const markManySeen = useCallback((fileIds: string[]) => {
    setSeen((prev) => {
      const now = Date.now();
      let changed = false;
      const next: SeenMap = { ...prev };
      for (const id of fileIds) {
        if (!next[id]) {
          next[id] = now;
          changed = true;
          pendingRef.current.add(id);
        }
      }
      if (changed) scheduleFlush();
      if (!changed) return prev;
      return persistMerge(next);
    });
  }, [scheduleFlush]);

  // Flush pending marks on page hide / unload so a user who marks and
  // immediately closes the tab still syncs. `keepalive: true` on the
  // fetch plus the visibilitychange hook covers the mobile case where
  // the tab is backgrounded without firing `unload`.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushNow);
    return () => {
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushNow);
      flushNow();
    };
  }, [flushNow]);

  // Mark-seen on folder-open events dispatched from use-files.ts.
  useEffect(() => {
    const onOpened = (e: Event) => {
      const detail = (e as CustomEvent<{ fileId?: string }>).detail;
      if (detail?.fileId) markSeen(detail.fileId);
    };
    window.addEventListener("securewarp-file-opened", onOpened);
    return () => window.removeEventListener("securewarp-file-opened", onOpened);
  }, [markSeen]);

  // Cross-tab sync for local dismisses.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setSeen(loadSeen());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const isNew = useCallback(
    (fileId: string, createdAtIso: string | null | undefined, serverSeenAtIso?: string | null): boolean => {
      if (!createdAtIso) return false;
      // Either the server knows they've seen it OR we've recorded it
      // locally — dismiss in both cases.
      if (serverSeenAtIso) return false;
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
