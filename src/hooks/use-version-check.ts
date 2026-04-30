"use client";

import { useEffect, useState } from "react";

/**
 * Polls /api/version and reports when the deployed bundle version
 * differs from the one the client booted with. Two severity tiers:
 *
 *   - "soft": polled check found a new version. User has time to
 *     finish whatever they're doing (upload, edit, etc.) before
 *     reloading. Banner is non-blocking.
 *   - "hard": a dynamic import fired ChunkLoadError, meaning the
 *     stale bundle is already broken. Banner switches copy to
 *     "update required" but the user still controls the reload —
 *     auto-reload would silently kill an in-flight upload.
 *
 * Soft → hard is one-way; once we see a chunk error we don't drop
 * back to soft on a successful next poll.
 */
export type VersionStatus = "ok" | "soft" | "hard";

const POLL_INTERVAL_MS = 60_000;
const INITIAL_DELAY_MS = 5 * 60_000;

export function useVersionCheck(): VersionStatus {
  const [status, setStatus] = useState<VersionStatus>("ok");

  useEffect(() => {
    // Dev preview override. `#preview-update=soft` or
    // `#preview-update=hard` forces the banner state without
    // bouncing a deploy through. No-op in production via the
    // explicit NODE_ENV check so a stray hash on prod can't fake
    // an update prompt.
    if (process.env.NODE_ENV !== "production") {
      const hash = window.location.hash;
      const m = /preview-update=(soft|hard)/.exec(hash);
      if (m) {
        setStatus(m[1] as VersionStatus);
        return;
      }
    }

    // The version baked into THIS bundle. Set in next.config.ts via
    // `env.NEXT_PUBLIC_BUILD_VERSION = getBuildVersion()`. Inlined at
    // build time, so it can't drift across the page lifetime.
    const localVersion = process.env.NEXT_PUBLIC_BUILD_VERSION;
    if (!localVersion) return; // no version baked in (older build) → skip

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { version?: string };
        if (cancelled) return;
        if (data.version && data.version !== localVersion) {
          // Don't downgrade hard → soft if a poll happens after a
          // chunk error. Hard is sticky.
          setStatus((curr) => (curr === "hard" ? curr : "soft"));
        }
      } catch {
        // Transient network error — try again on the next tick.
      }
    };

    // Wait a few minutes after first load before polling. A user who
    // just opened the tab is by definition running the latest version
    // their HTML pointed at, so an immediate poll is wasted work.
    const initialTimer = setTimeout(() => {
      void poll();
      const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
      pollTimer = interval as unknown as ReturnType<typeof setTimeout>;
    }, INITIAL_DELAY_MS);

    // ChunkLoadError signal. Webpack/Turbopack throw a real error
    // object with name === "ChunkLoadError" or message including
    // "Loading chunk". Catch both shapes so a future bundler swap
    // doesn't silently break the wiring.
    const onError = (e: ErrorEvent) => {
      const err = e.error as { name?: string; message?: string } | null;
      const msg = err?.message ?? e.message ?? "";
      const isChunkErr =
        err?.name === "ChunkLoadError" ||
        /Loading chunk [\w-]+ failed/i.test(msg) ||
        /Failed to fetch dynamically imported module/i.test(msg);
      if (isChunkErr) setStatus("hard");
    };
    const onUnhandled = (e: PromiseRejectionEvent) => {
      const reason = e.reason as { name?: string; message?: string } | null;
      const msg = reason?.message ?? "";
      const isChunkErr =
        reason?.name === "ChunkLoadError" ||
        /Loading chunk [\w-]+ failed/i.test(msg) ||
        /Failed to fetch dynamically imported module/i.test(msg);
      if (isChunkErr) setStatus("hard");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      if (pollTimer) clearInterval(pollTimer as unknown as number);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);

  return status;
}
