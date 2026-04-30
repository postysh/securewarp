"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/sidebar";
import { FileBrowser } from "@/components/file-browser";
// AuthScreen is a big component (full auth UI, SRP client, Turnstile,
// recovery modal). On the happy path — user has keys in sessionStorage
// — we never render it. Ship it as a separate chunk and load only if
// the keys-missing branch fires. loading:null → no fallback flash
// between drive-client mounting and the lazy chunk resolving; the
// surrounding ThemeProvider still paints the background.
const AuthScreen = dynamic(
  () => import("@/components/auth-screen").then((m) => ({ default: m.AuthScreen })),
  { ssr: false, loading: () => null },
);
import { MobileNav } from "@/components/mobile-nav";
import { AnnouncementBanner } from "@/components/announcement-banner";
import { UpdateBanner } from "@/components/update-banner";
import { UserKeysContext, type UserKeys } from "@/hooks/use-user-keys";
import {
  FilesContext,
  FilesStateContext,
  FilesActionsContext,
  useFiles,
} from "@/hooks/use-files";
import { BootContext, type BootPayload } from "@/hooks/use-boot";
import { prewarmDownloadSw } from "@/lib/net/download-sink";

export default function DriveClient() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("sidebar_open") !== "false";
    }
    return true;
  });
  const [keys, setKeys] = useState<UserKeys | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [removedFromWorkspace, setRemovedFromWorkspace] = useState<string | null>(null);

  // The workspace-switcher polling detects when the active workspace
  // disappears from the caller's membership list (kicked out, workspace
  // deleted, role changed to revoked). It dispatches this custom event
  // so we can surface a banner BEFORE the user tries another workspace-
  // scoped action and hits a cascade of 404s.
  useEffect(() => {
    const onRemoved = (e: Event) => {
      const name = (e as CustomEvent<{ workspaceName?: string }>).detail
        ?.workspaceName;
      setRemovedFromWorkspace(name ?? "that workspace");
    };
    window.addEventListener("securewarp-workspace-removed", onRemoved);
    return () =>
      window.removeEventListener("securewarp-workspace-removed", onRemoved);
  }, []);

  // Pre-warm the streaming-download service worker on every drive
  // mount. Registration takes a few hundred ms on the first visit
  // (script fetch + install + activate + clients.claim), and the
  // download-sink path REQUIRES the document to be controlled by the
  // SW or it falls back to the in-memory blob (which OOMs on multi-GB
  // files). Doing this on mount instead of on first download click
  // means the user has typically been on the page for several seconds
  // before they hit Download, so the SW is already controlling and
  // the click → fetch → SW interception path works.
  useEffect(() => {
    prewarmDownloadSw();
  }, []);

  useEffect(() => {
    // Decrypted private keys live only in sessionStorage — per-tab,
    // wiped when the tab closes. The auth JWT cookie OUTLIVES the tab
    // (7-day persistent cookie), so a user who closes the window then
    // returns is "logged in" from the server's perspective but has no
    // key material to decrypt anything. We can't redirect to /login
    // because middleware bounces authenticated users back to /drive;
    // instead, render AuthScreen inline. AuthScreen will auto-detect
    // the lock cache and show the unlock form, or fall back to the
    // full login form if the cache is gone. Deliberately not
    // persisting the plaintext keys in localStorage — doing so would
    // survive any XSS payload, which defeats the purpose of
    // zero-knowledge client-side-only key storage.
    const refresh = () => {
      const stored = sessionStorage.getItem("securewarp_keys");
      setKeys(stored ? JSON.parse(stored) : null);
    };
    refresh();
    setHydrated(true);
    window.addEventListener("securewarp-keys-updated", refresh);
    return () => window.removeEventListener("securewarp-keys-updated", refresh);
  }, []);

  // Single /api/auth/profile probe that services two concerns:
  //
  //   1. Zombie-session guard — `middleware.ts` trusts the JWT
  //      signature alone (no DB lookup per request, by design), while
  //      `getSession()` in route handlers requires a matching
  //      `sessions` row. After a data wipe or a revoked session, the
  //      cookie's signature still validates → middleware redirects
  //      /login and /signup back to /drive → drive-client sees empty
  //      sessionStorage → renders AuthScreen inline → user clicks
  //      "Sign up" and nothing appears to happen because the URL
  //      snaps straight back. A 401 here means the cookie is dead;
  //      clear it via /api/auth/logout so the next nav attempt
  //      lands.
  //
  //   2. Onboarding gate — returning users who never completed the
  //      wizard bounce to /welcome. This branch only fires once keys
  //      are present (we don't redirect a tab that's still on the
  //      unlock form).
  //
  // Previously these were two separate useEffects with two fetches.
  // The response data is identical (same user, same onboarded flag),
  // so we cache it in a ref and re-apply the onboarding check when
  // keys arrive later in the session.
  // Bootstrap fetch — one aggregated call that returns profile +
  // pins + labels + usage + workspaces + realtime channel names.
  // Replaces the wave of independent fetches that used to fire on
  // mount from drive-client + sidebar + notifications. Individual
  // endpoints stay live for refreshes. Also serves the double duty
  // of the old profile probe (zombie-cookie guard + onboarding gate
  // + 401-clear) since /api/boot has the same auth check.
  const [boot, setBoot] = useState<BootPayload | null>(null);
  const bootFetchedRef = useRef(false);
  useEffect(() => {
    if (!hydrated) return;
    if (bootFetchedRef.current) {
      // Already fetched this mount. Re-apply the onboarding gate to
      // the (possibly newly-arrived) keys without a second round-trip.
      if (keys && boot?.profile?.onboarded === false) {
        router.replace("/welcome");
      }
      return;
    }
    bootFetchedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/boot", { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 401) {
          // Zombie cookie. Clear it so auth-route middleware stops
          // redirecting /login ↔ /signup back to /drive.
          await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as BootPayload;
          if (cancelled) return;
          setBoot(data);
          if (keys && data.profile?.onboarded === false) {
            router.replace("/welcome");
          }
        }
      } catch {
        // Network flake — consumers will fall back to their own
        // per-endpoint fetches since BootContext stays null.
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, keys, router, boot]);

  // Single useFiles instance shared between sidebar (for "Shared with me"
  // view toggle) and the file browser. Created here so its state outlives
  // any one child unmounting. Returns { api, state, actions } — api is
  // the legacy flat shape for existing callers; state + actions feed
  // the split contexts below for perf-sensitive consumers.
  const { api: fileOps, state: filesState, actions: filesActions } = useFiles(
    keys
      ? {
          encryptionPublicKey: keys.encryptionPublicKey,
          encryptionPrivateKey: keys.encryptionPrivateKey,
          kemPublicKey: keys.kemPublicKey,
          kemPrivateKey: keys.kemPrivateKey,
          email: keys.email,
        }
      : null,
  );

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar_open", String(next));
      return next;
    });
  };

  // Preload the isolated viewer subdomain in a hidden iframe so the
  // first real preview doesn't have to fight through Cloudflare's bot
  // challenge + cold chunk download while the user is staring at a
  // loading state. By the time they click a file, cf_clearance is set
  // and the viewer's JS is in the HTTP cache. The iframe is zero-size,
  // invisible, and pointer-events:none so it doesn't affect layout or
  // accessibility. Its src points at the base /viewer route (smallest
  // page — just the PDF viewer shell, no mammoth/exceljs loaded) which
  // is enough to clear the Cloudflare challenge and cache the shared
  // chunks that all three viewer routes import.
  //
  // Deferred: we don't mount the iframe on first render anymore
  // (users who never open a preview paid the cost). Instead we flip
  // `preloadViewer` when the first file hover fires, OR on an idle
  // callback so the warmup still happens for users who go straight
  // to a download.
  //
  // IMPORTANT: this useState + useEffect MUST be declared above the
  // `if (!hydrated)` / `if (!keys)` early returns below. Placing
  // them after would change the hook order between the unlock-form
  // render and the drive render, which React strictly forbids.
  const viewerOrigin = process.env.NEXT_PUBLIC_PDF_VIEWER_ORIGIN?.trim();
  const [preloadViewer, setPreloadViewer] = useState(false);
  useEffect(() => {
    if (!viewerOrigin || !keys || preloadViewer) return;
    const trigger = () => setPreloadViewer(true);
    // Any user interaction with the drive shell (hover, touch, key)
    // is a reasonable signal they might preview something. Listen
    // once and clean up — no reason to keep listeners wired after
    // the iframe mounts.
    const opts: AddEventListenerOptions = { once: true, passive: true };
    window.addEventListener("pointermove", trigger, opts);
    window.addEventListener("pointerdown", trigger, opts);
    window.addEventListener("keydown", trigger, opts);
    // Idle fallback for users who go straight to a download without
    // hovering first — still want the iframe warmed up so it's ready
    // on first actual preview click.
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    const w = window as IdleWindow;
    if (typeof w.requestIdleCallback === "function") {
      idleHandle = w.requestIdleCallback(trigger, { timeout: 4000 });
    } else {
      timeoutHandle = setTimeout(trigger, 3000);
    }
    return () => {
      window.removeEventListener("pointermove", trigger);
      window.removeEventListener("pointerdown", trigger);
      window.removeEventListener("keydown", trigger);
      if (idleHandle !== null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle) clearTimeout(timeoutHandle);
    };
  }, [viewerOrigin, keys, preloadViewer]);

  if (!hydrated) {
    return null;
  }

  if (!keys) {
    return (
      <ThemeProvider>
        <AuthScreen mode="login" />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <UserKeysContext.Provider value={keys}>
        <BootContext.Provider value={boot}>
        <FilesActionsContext.Provider value={filesActions}>
        <FilesStateContext.Provider value={filesState}>
        <FilesContext.Provider value={fileOps}>
          {viewerOrigin && preloadViewer && (
            <iframe
              src={`${viewerOrigin}/viewer`}
              aria-hidden
              tabIndex={-1}
              style={{
                position: "absolute",
                width: 0,
                height: 0,
                border: 0,
                opacity: 0,
                pointerEvents: "none",
                overflow: "hidden",
              }}
            />
          )}
          {removedFromWorkspace && (
            <div
              role="alertdialog"
              aria-modal="true"
              className="fixed inset-0 z-[9999] flex items-center justify-center"
            >
              <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" />
              <div
                className="relative w-full max-w-[420px] mx-4 rounded-2xl bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in"
                style={{ boxShadow: "var(--shadow-l2)" }}
              >
                <div className="px-6 pt-6 pb-4">
                  <div className="text-[16px] font-semibold text-text-primary">
                    Removed from workspace
                  </div>
                  <p className="mt-2 text-[13px] text-text-secondary leading-relaxed">
                    Your access to <strong>{removedFromWorkspace}</strong> was
                    revoked. You&apos;ve been returned to your personal drive.
                  </p>
                </div>
                <div className="flex justify-end gap-2 px-6 py-4 border-t border-border-tertiary bg-bg-side">
                  <button
                    onClick={() => setRemovedFromWorkspace(null)}
                    className="h-9 px-4 rounded-lg bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    Got it
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="flex h-full bg-bg-side">
            {/* Desktop sidebar — inline */}
            <div className="relative z-20 h-full hidden md:block">
              <Sidebar collapsed={!sidebarOpen} />
            </div>
            {/* Mobile sidebar is replaced by MobileNav bottom bar */}
            <div className={`flex-1 p-2 ${sidebarOpen ? "md:pl-0" : ""} relative z-10 pb-[72px] md:pb-2`}>
              <div className="h-full rounded-xl border border-border-secondary bg-bg-main overflow-hidden flex flex-col">
                <UpdateBanner />
                <AnnouncementBanner />
                <div className="flex-1 min-h-0 flex flex-col">
                  <FileBrowser sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
                </div>
              </div>
            </div>
            <MobileNav onSearch={() => window.dispatchEvent(new Event("securewarp-open-search"))} />
          </div>
        </FilesContext.Provider>
        </FilesStateContext.Provider>
        </FilesActionsContext.Provider>
        </BootContext.Provider>
      </UserKeysContext.Provider>
    </ThemeProvider>
  );
}
