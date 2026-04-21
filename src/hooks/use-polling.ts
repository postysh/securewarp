"use client";

import { useEffect, useRef } from "react";

/**
 * Simple polling primitive — runs `callback` every `intervalMs` while
 * the tab is visible. Pauses when the Page Visibility API reports
 * hidden, then fires once immediately on return (so a user who tabs
 * back sees a fresh view without waiting for the next interval).
 *
 * We poll rather than WebSocket/Realtime because:
 *   - Cloudflare Workers prefers short-lived requests.
 *   - Our RLS posture is deny-all to the anon key; Supabase Realtime
 *     would require a parallel policy set that mirrors our API
 *     access model exactly. Too much surface area for a <1s latency
 *     improvement on events that are fine with 15-30s freshness.
 *
 * Callers keep their callback stable (useCallback) so the interval
 * isn't re-created on every render.
 */
export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  options: { enabled?: boolean } = {},
): void {
  const { enabled = true } = options;
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined") return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        void savedCallback.current();
      }, intervalMs);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        // Fire immediately on return, then resume the interval.
        void savedCallback.current();
        start();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") start();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [intervalMs, enabled]);
}
