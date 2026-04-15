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
    keys ? { encryptionPublicKey: keys.encryptionPublicKey, encryptionPrivateKey: keys.encryptionPrivateKey } : null
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

  return (
    <ThemeProvider>
      <UserKeysContext.Provider value={keys}>
        <FilesContext.Provider value={fileOps}>
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
