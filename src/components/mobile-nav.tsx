"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import HardDriveIcon from "@hugeicons/core-free-icons/HardDriveIcon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Setting07Icon from "@hugeicons/core-free-icons/Setting07Icon";
import { useFilesContext, type ViewMode } from "@/hooks/use-files";
import { SettingsModal } from "./settings-modal";

const navItems: { id: string; icon: unknown; label: string; viewMode?: ViewMode }[] = [
  { id: "drive", icon: HardDriveIcon, label: "My Drive", viewMode: "own" },
  { id: "shared", icon: UserGroupIcon, label: "Shared", viewMode: "shared" },
  { id: "search", icon: Search01Icon, label: "Search" },
  { id: "trash", icon: Delete02Icon, label: "Trash", viewMode: "trash" },
  { id: "settings", icon: Setting07Icon, label: "Settings" },
];

interface MobileNavProps {
  onSearch: () => void;
}

export function MobileNav({ onSearch }: MobileNavProps) {
  const fileOps = useFilesContext();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const active =
    fileOps.viewMode === "trash"
      ? "trash"
      : fileOps.viewMode === "shared"
        ? "shared"
        : "drive";

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-bg-side border-t border-border-tertiary safe-area-bottom">
        <div className="flex items-center justify-around h-[56px]">
          {navItems
            .filter((item) => !fileOps.activeWorkspace || item.id === "drive" || item.id === "search" || item.id === "settings" || item.id === "trash")
            .filter((item) => !fileOps.activeWorkspace || item.id !== "shared")
            .map((item) => {
            const isActive = item.id === active;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === "search") {
                    onSearch();
                  } else if (item.id === "settings") {
                    setSettingsOpen(true);
                  } else if (item.viewMode) {
                    fileOps.setViewMode(item.viewMode);
                  }
                }}
                className={`flex flex-col items-center justify-center gap-0.5 w-[64px] h-[44px] rounded-[10px] transition-colors cursor-pointer ${
                  isActive
                    ? "text-accent-green"
                    : "text-icon-tertiary"
                }`}
              >
                <HugeiconsIcon
                  icon={item.icon as Parameters<typeof HugeiconsIcon>[0]["icon"]}
                  size={20}
                  color={isActive ? "var(--accent-green-primary)" : "var(--icon-tertiary)"}
                />
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
