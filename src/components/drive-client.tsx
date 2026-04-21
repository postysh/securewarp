"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/sidebar";
import { FileBrowser } from "@/components/file-browser";
import { AuthScreen } from "@/components/auth-screen";
import { MobileNav } from "@/components/mobile-nav";
import { AnnouncementBanner } from "@/components/announcement-banner";
import { UserKeysContext, type UserKeys } from "@/hooks/use-user-keys";
import { FilesContext, useFiles } from "@/hooks/use-files";

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

  // Zombie-session guard. `middleware.ts` trusts the JWT signature alone
  // (no DB lookup per request, by design), while `getSession()` in route
  // handlers requires a matching `sessions` row. After a data wipe or a
  // revoked session, the cookie's signature still validates → middleware
  // redirects /login and /signup back to /drive → drive-client sees
  // empty sessionStorage → renders AuthScreen inline → user clicks
  // "Sign up" or "Sign in" and nothing appears to happen because the
  // URL snaps straight back. We detect the zombie state by probing
  // /api/auth/profile (which uses getSession) — a 401 means the cookie
  // is dead. Clear it via /api/auth/logout so the next nav attempt is
  // treated as an unauthenticated request and actually lands.
  //
  // Only runs when we're about to fall back to the inline AuthScreen.
  // If keys are present in sessionStorage we skip entirely — nothing
  // to guard against, and profile-probing that path runs in the
  // onboarding gate below already.
  useEffect(() => {
    if (!hydrated || keys) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/profile", { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 401) {
          // Zombie cookie. Clear it so auth-route middleware stops
          // redirecting /login ↔ /signup back to /drive.
          await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        }
      } catch {
        // Network flake — leave cookie in place; user can still
        // attempt login, and the server will reject the duplicate
        // session if need be.
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, keys]);

  // Gate: returning users who never onboarded (pre-wizard accounts, or
  // anyone who closed the tab mid-wizard) get bounced to /welcome. We
  // only check once keys are present — an unlock-needed state shows
  // AuthScreen below and should not trigger a redirect.
  useEffect(() => {
    if (!keys) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/profile");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.onboarded === false) router.replace("/welcome");
      } catch {
        // Profile fetch failure is non-fatal — drive stays rendered,
        // user can retry onboarding from settings later.
      }
    })();
    return () => { cancelled = true; };
  }, [keys, router]);

  // Single useFiles instance shared between sidebar (for "Shared with me"
  // view toggle) and the file browser. Created here so its state outlives
  // any one child unmounting.
  const fileOps = useFiles(
    keys
      ? {
          encryptionPublicKey: keys.encryptionPublicKey,
          encryptionPrivateKey: keys.encryptionPrivateKey,
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
  const viewerOrigin = process.env.NEXT_PUBLIC_PDF_VIEWER_ORIGIN?.trim();

  return (
    <ThemeProvider>
      <UserKeysContext.Provider value={keys}>
        <FilesContext.Provider value={fileOps}>
          {viewerOrigin && (
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
          <div className="flex h-full bg-bg-side">
            {/* Desktop sidebar — inline */}
            <div className="relative z-20 h-full hidden md:block">
              <Sidebar collapsed={!sidebarOpen} />
            </div>
            {/* Mobile sidebar is replaced by MobileNav bottom bar */}
            <div className={`flex-1 p-2 ${sidebarOpen ? "md:pl-0" : ""} relative z-10 pb-[72px] md:pb-2`}>
              <div className="h-full rounded-xl border border-border-secondary bg-bg-main overflow-hidden flex flex-col">
                <AnnouncementBanner />
                <div className="flex-1 min-h-0 flex flex-col">
                  <FileBrowser sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
                </div>
              </div>
            </div>
            <MobileNav onSearch={() => window.dispatchEvent(new Event("securewarp-open-search"))} />
          </div>
        </FilesContext.Provider>
      </UserKeysContext.Provider>
    </ThemeProvider>
  );
}
