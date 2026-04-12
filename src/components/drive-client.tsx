"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/sidebar";
import { FileBrowser } from "@/components/file-browser";
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

  useEffect(() => {
    // Decrypted private keys live only in sessionStorage — per-tab,
    // wiped when the tab closes. The auth JWT cookie OUTLIVES the tab
    // (7-day persistent cookie), so a user who closes the window then
    // returns is "logged in" from the server's perspective but has no
    // key material to decrypt anything. Left unfixed, the dashboard
    // would load empty: no files decrypt, no email in the sidebar,
    // and the only escape is the Sign out button (which re-auths from
    // scratch). Detect that state and redirect to /login so the user
    // re-derives keys from their password via SRP. Deliberately not
    // persisting keys in localStorage — doing so would survive any
    // XSS payload, which defeats the purpose of zero-knowledge
    // client-side-only key storage.
    const stored = sessionStorage.getItem("securewarp_keys");
    if (stored) {
      setKeys(JSON.parse(stored));
      return;
    }
    // No keys in memory — check whether the server still thinks we're
    // logged in. If so, redirect to /login which re-runs the SRP
    // flow and repopulates sessionStorage on success. If the cookie
    // is also gone, /login is where we want to go anyway.
    router.replace("/login");
  }, [router]);

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

  return (
    <ThemeProvider>
      <UserKeysContext.Provider value={keys}>
        <FilesContext.Provider value={fileOps}>
          <div className="flex h-full bg-bg-side">
            <div className="relative z-20 h-full">
              <Sidebar collapsed={!sidebarOpen} />
            </div>
            <div className={`flex-1 p-2 ${sidebarOpen ? "pl-0" : ""} relative z-10`}>
              <div className="h-full rounded-xl border border-border-secondary bg-bg-main overflow-hidden">
                <FileBrowser sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
              </div>
            </div>
          </div>
        </FilesContext.Provider>
      </UserKeysContext.Provider>
    </ThemeProvider>
  );
}
