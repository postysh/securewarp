"use client";

import { useState } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/sidebar";
import { FileBrowser } from "@/components/file-browser";

export default function DrivePage() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <ThemeProvider>
      <div className="flex h-full bg-bg-side">
        <div className="relative z-20 h-full">
          <Sidebar collapsed={!sidebarOpen} />
        </div>
        <div className={`flex-1 p-2 ${sidebarOpen ? "pl-0" : ""} relative z-10`}>
          <div className="h-full rounded-xl border border-border-secondary bg-bg-main overflow-hidden">
            <FileBrowser sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}
