"use client";

import { useState, useEffect } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/sidebar";
import { FileBrowser } from "@/components/file-browser";
import { UserKeysContext, type UserKeys } from "@/hooks/use-user-keys";
import { FilesContext, useFiles } from "@/hooks/use-files";

export default function DriveClient() {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("sidebar_open") !== "false";
    }
    return true;
  });
  const [keys, setKeys] = useState<UserKeys | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem("securewarp_keys");
    if (stored) {
      setKeys(JSON.parse(stored));
    }
  }, []);

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
