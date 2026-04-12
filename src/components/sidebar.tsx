"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import HardDriveIcon from "@hugeicons/core-free-icons/HardDriveIcon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import StarIcon from "@hugeicons/core-free-icons/StarIcon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import Setting07Icon from "@hugeicons/core-free-icons/Setting07Icon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import Sun01Icon from "@hugeicons/core-free-icons/Sun01Icon";
import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";
import Upload04Icon from "@hugeicons/core-free-icons/Upload04Icon";
import CloudServerIcon from "@hugeicons/core-free-icons/CloudServerIcon";
import PinIcon from "@hugeicons/core-free-icons/PinIcon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import Tag01Icon from "@hugeicons/core-free-icons/Tag01Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import UserCircleIcon from "@hugeicons/core-free-icons/UserCircleIcon";
import Logout01Icon from "@hugeicons/core-free-icons/Logout01Icon";
import Key01Icon from "@hugeicons/core-free-icons/Key01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import { useTheme } from "./theme-provider";
import { Tooltip } from "./tooltip";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { SettingsModal } from "./settings-modal";
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useUserKeys } from "@/hooks/use-user-keys";
import { useFilesContext } from "@/hooks/use-files";

function formatStorageBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(size < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function useStorageUsage() {
  const [usage, setUsage] = useState({ usedBytes: 0, maxBytes: 20 * 1024 * 1024 * 1024, fileCount: 0 });
  useEffect(() => {
    fetch("/api/files/usage").then(r => r.json()).then(data => {
      if (data.usedBytes !== undefined) setUsage(data);
    }).catch(() => {});
  }, []);
  return usage;
}

const navItems = [
  { icon: HardDriveIcon, label: "My Drive", id: "drive" },
  { icon: Clock01Icon, label: "Recent", id: "recent" },
  { icon: StarIcon, label: "Starred", id: "starred" },
  { icon: UserGroupIcon, label: "Shared with me", id: "shared" },
  { icon: Delete02Icon, label: "Trash", id: "trash" },
];

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { theme, toggle } = useTheme();
  const userKeys = useUserKeys();
  const userEmail = userKeys?.email || "";
  const [open, setOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    if (collapsed) {
      setPos({ top: rect.bottom - 200, left: rect.right + 8 });
    } else {
      setPos({ top: rect.top - 208, left: rect.left });
    }
  }, [collapsed]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleToggle = () => {
    if (!open) updatePos();
    setOpen(!open);
  };

  const button = (
    <button
      ref={btnRef}
      onClick={handleToggle}
      className={`rounded-[6px] transition-colors cursor-pointer flex items-center ${
        collapsed
          ? "w-8 h-8 justify-center text-icon-tertiary hover:bg-cta-nav-hover"
          : "w-full gap-3 px-2.5 h-[36px] text-[13px] text-text-secondary hover:bg-cta-nav-hover"
      }`}
    >
      <HugeiconsIcon icon={UserCircleIcon} size={18} />
      {!collapsed && (
        <span className="text-text-primary text-[12px] font-medium truncate">{userEmail}</span>
      )}
    </button>
  );

  const dropdown = open && createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] w-[200px] rounded-[8px] bg-bg-l3 border border-border-primary overflow-hidden"
      style={{ top: pos.top, left: pos.left, boxShadow: "var(--shadow-l2)" }}
    >
      <div className="px-3 py-2.5 border-b border-border-tertiary">
        <div className="text-[12px] text-text-primary font-medium truncate">{userEmail}</div>
        <div className="text-[11px] text-text-disabled mt-0.5">Free plan</div>
      </div>
      <div className="py-1">
        <button
          onClick={() => { toggle(); setOpen(false); }}
          className="w-full flex items-center gap-2.5 px-3 h-[32px] text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
        >
          <HugeiconsIcon icon={theme === "dark" ? Sun01Icon : Moon02Icon} size={15} />
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <button onClick={() => { setSettingsOpen(true); setOpen(false); }} className="w-full flex items-center gap-2.5 px-3 h-[32px] text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer">
          <HugeiconsIcon icon={Setting07Icon} size={15} />
          Settings
        </button>
        <button onClick={() => { setRecoveryOpen(true); setOpen(false); }} className="w-full flex items-center gap-2.5 px-3 h-[32px] text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer">
          <HugeiconsIcon icon={Key01Icon} size={15} />
          Recovery key info
        </button>
      </div>
      <div className="py-1 border-t border-border-tertiary">
        <button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }} className="w-full flex items-center gap-2.5 px-3 h-[32px] text-[12px] text-accent-red hover:bg-bg-cell-hover transition-colors cursor-pointer">
          <HugeiconsIcon icon={Logout01Icon} size={15} />
          Sign out
        </button>
      </div>
    </div>,
    document.body
  );

  return (
    <div className={`${collapsed ? "flex justify-center" : ""}`}>
      {collapsed ? <Tooltip label="Account">{button}</Tooltip> : button}
      {dropdown}
      {recoveryOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={() => setRecoveryOpen(false)} />
          <div className="relative w-full max-w-[400px] mx-4 rounded-2xl bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in" style={{ boxShadow: "var(--shadow-l2)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center">
                  <HugeiconsIcon icon={Key01Icon} size={18} color="var(--accent-yellow-primary)" />
                </div>
                <span className="text-[14px] font-semibold text-text-primary">Recovery Key</span>
              </div>
              <button onClick={() => setRecoveryOpen(false)} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer">
                <HugeiconsIcon icon={Cancel01Icon} size={16} />
              </button>
            </div>
            <div className="px-5 py-5 space-y-3">
              <p className="text-[13px] text-text-primary">Your 24-word recovery phrase was shown when you created your account.</p>
              <p className="text-[12px] text-text-tertiary leading-relaxed">For security, the recovery phrase cannot be displayed again. If you saved it (copied or downloaded the file), keep it somewhere safe. It&apos;s the only way to recover your account if you forget your password.</p>
              <p className="text-[12px] text-text-tertiary leading-relaxed">If you&apos;ve lost your recovery phrase, you can generate a new one by changing your password in Settings.</p>
              <div className="flex justify-end pt-2">
                <button onClick={() => setRecoveryOpen(false)} className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-all cursor-pointer">Got it</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const fileOps = useFilesContext();
  // Derive the highlighted nav item from the breadcrumb's root, not the
  // viewMode. Navigating into a shared folder sets viewMode="own" because
  // the listing endpoint handles both ownership paths, but the user is
  // still semantically inside "Shared with me" — the breadcrumb root
  // reflects that truth.
  const active =
    fileOps.viewMode === "trash"
      ? "trash"
      : fileOps.viewMode === "starred"
        ? "starred"
        : fileOps.viewMode === "recent"
          ? "recent"
          : fileOps.breadcrumb[0]?.name === "Shared with me"
            ? "shared"
            : "drive";
  // Pins + labels — fetched once on mount
  const [pins, setPins] = useState<{ file_id: string; name?: string; isFolder?: boolean }[]>([]);
  const [labels, setLabels] = useState<{ id: string; name: string; color: string }[]>([]);
  const [newLabelName, setNewLabelName] = useState("");
  const [showNewLabel, setShowNewLabel] = useState(false);

  const labelColors = [
    "var(--accent-blue-primary)",
    "var(--accent-green-primary)",
    "var(--accent-yellow-primary)",
    "var(--accent-pink-primary)",
    "var(--accent-red-primary)",
    "var(--accent-orange-primary)",
  ];
  const [newLabelColor, setNewLabelColor] = useState(labelColors[0]);

  useEffect(() => {
    fetch("/api/pins").then((r) => r.json()).then((d) => {
      if (d.pins) {
        const resolved = d.pins.map((p: { file_id: string; is_folder: boolean }) => {
          // Try to get the decrypted name from the current file list
          const f = fileOps.files.find((x) => x.id === p.file_id);
          return { file_id: p.file_id, name: f?.name ?? "Pinned item", isFolder: p.is_folder };
        });
        setPins(resolved);
      }
    }).catch(() => {});
    fetch("/api/labels").then((r) => r.json()).then((d) => {
      if (d.labels) setLabels(d.labels);
    }).catch(() => {});
  }, [fileOps.files]);

  const storage = useStorageUsage();
  const usedPct = storage.maxBytes > 0 ? Math.min((storage.usedBytes / storage.maxBytes) * 100, 100) : 0;
  const usedLabel = formatStorageBytes(storage.usedBytes);
  const maxLabel = formatStorageBytes(storage.maxBytes);

  const storageTooltipContent = (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <HugeiconsIcon icon={CloudServerIcon} size={14} color="var(--accent-green-primary)" />
        <span className="text-[12px] text-text-primary font-medium">Storage</span>
      </div>
      <div className="h-[4px] bg-bg-field rounded-full overflow-hidden mb-2">
        <div className="h-full bg-accent-green rounded-full transition-all" style={{ width: `${usedPct}%` }} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-text-tertiary">{usedLabel} of {maxLabel}</span>
        <span className="text-[10px] text-accent-green font-medium">Upgrade</span>
      </div>
    </div>
  );

  return (
    <aside
      className="h-full flex flex-col shrink-0 bg-bg-side select-none overflow-visible transition-all duration-200 ease-in-out"
      style={{ width: collapsed ? 52 : 195, minWidth: collapsed ? 52 : 195 }}
    >
      {/* Workspace switcher */}
      <div className={`shrink-0 transition-all duration-200 ${collapsed ? "flex justify-center py-3" : "px-2 py-3"}`}>
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>

      {/* Nav */}
      <nav className={`flex-1 py-3 overflow-y-auto overflow-x-hidden transition-all duration-200 ${collapsed ? "px-[10px]" : "px-2"}`}>
        <div className={`flex flex-col gap-[2px] ${collapsed ? "items-center" : ""}`}>
          {navItems.map((item) => {
            const handleClick = () => {
              if (item.id === "drive") fileOps.setViewMode("own");
              else if (item.id === "recent") fileOps.setViewMode("recent");
              else if (item.id === "starred") fileOps.setViewMode("starred");
              else if (item.id === "shared") fileOps.setViewMode("shared");
              else if (item.id === "trash") fileOps.setViewMode("trash");
            };
            const btn = (
              <button
                key={item.id}
                onClick={handleClick}
                className={`flex items-center rounded-[6px] transition-colors cursor-pointer ${
                  collapsed
                    ? "w-8 h-8 justify-center"
                    : "w-full gap-3 px-2.5 h-[32px] text-[13px]"
                } ${
                  active === item.id
                    ? "bg-cta-nav-active text-text-primary font-medium"
                    : "text-text-secondary hover:bg-cta-nav-hover"
                }`}
              >
                <HugeiconsIcon icon={item.icon} size={18} />
                {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
              </button>
            );
            return collapsed ? (
              <Tooltip key={item.id} label={item.label}>{btn}</Tooltip>
            ) : (
              <div key={item.id}>{btn}</div>
            );
          })}
        </div>

        {/* Pinned */}
        {collapsed ? (
          pins.length > 0 && (
            <div className="flex flex-col items-center gap-[2px] mt-3 pt-3 border-t border-border-tertiary">
              <Tooltip label="Pinned">
                <div className="w-8 h-8 rounded-[6px] flex items-center justify-center text-icon-tertiary">
                  <HugeiconsIcon icon={PinIcon} size={16} />
                </div>
              </Tooltip>
            </div>
          )
        ) : (
          <div className="mt-3 pt-3 border-t border-border-tertiary">
            <div className="flex items-center justify-between px-2.5 mb-1">
              <span className="text-[11px] font-mono uppercase text-text-disabled">Pinned</span>
            </div>
            {pins.length === 0 ? (
              <p className="px-2.5 text-[11px] text-text-disabled">No pinned items</p>
            ) : (
              <div className="flex flex-col gap-[2px]">
                {pins.map((pin) => (
                  <button
                    key={pin.file_id}
                    onClick={() => {
                      if (pin.isFolder) {
                        fileOps.navigateToFolder(pin.file_id, pin.name ?? "Folder");
                      } else {
                        window.dispatchEvent(new CustomEvent("securewarp-preview-file", { detail: pin.file_id }));
                      }
                    }}
                    className="w-full flex items-center gap-3 px-2.5 h-[30px] rounded-[6px] text-[12px] text-text-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer"
                  >
                    <HugeiconsIcon icon={pin.isFolder ? Folder01Icon : File01Icon} size={15} color={pin.isFolder ? "var(--accent-blue-primary)" : "var(--icon-tertiary)"} />
                    <span className="whitespace-nowrap truncate">{pin.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Labels */}
        {collapsed ? (
          labels.length > 0 && (
            <div className="flex flex-col items-center gap-[2px] mt-3 pt-3 border-t border-border-tertiary">
              <Tooltip label="Labels">
                <div className="w-8 h-8 rounded-[6px] flex items-center justify-center text-icon-tertiary">
                  <HugeiconsIcon icon={Tag01Icon} size={16} />
                </div>
              </Tooltip>
            </div>
          )
        ) : (
          <div className="mt-3 pt-3 border-t border-border-tertiary">
            <div className="flex items-center justify-between px-2.5 mb-1">
              <span className="text-[11px] font-mono uppercase text-text-disabled">Labels</span>
              <button
                onClick={() => setShowNewLabel(!showNewLabel)}
                className="p-0.5 rounded text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={PlusSignIcon} size={12} />
              </button>
            </div>
            {showNewLabel && (
              <div className="px-2.5 mb-2 space-y-1.5 animate-fade-in">
                <input
                  type="text"
                  value={newLabelName}
                  onChange={(e) => setNewLabelName(e.target.value)}
                  placeholder="Label name"
                  className="w-full px-2 py-1.5 rounded-[6px] bg-bg-field text-[11px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-1 focus:ring-accent-green/30"
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && newLabelName.trim()) {
                      const res = await fetch("/api/labels", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: newLabelName.trim(), color: newLabelColor }),
                      });
                      if (res.ok) {
                        const d = await res.json();
                        setLabels((prev) => [...prev, d.label]);
                        setNewLabelName("");
                        setShowNewLabel(false);
                      }
                    }
                    if (e.key === "Escape") setShowNewLabel(false);
                  }}
                />
                <div className="flex gap-1">
                  {labelColors.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewLabelColor(c)}
                      className={`w-5 h-5 rounded-full cursor-pointer transition-transform ${newLabelColor === c ? "scale-125 ring-2 ring-white/30" : ""}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            )}
            {labels.length === 0 && !showNewLabel ? (
              <p className="px-2.5 text-[11px] text-text-disabled">No labels yet</p>
            ) : (
              <div className="flex flex-col gap-[2px]">
                {labels.map((tag) => (
                  <button
                    key={tag.id}
                    className="w-full flex items-center gap-3 px-2.5 h-[30px] rounded-[6px] text-[12px] text-text-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer"
                  >
                    <div className="w-[10px] h-[10px] rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    <span className="whitespace-nowrap truncate">{tag.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Storage */}
      {collapsed ? (
        <div className="flex justify-center mb-1">
          <Tooltip label="Storage" content={storageTooltipContent}>
            <button className="w-8 h-8 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover flex items-center justify-center transition-colors cursor-pointer">
              <HugeiconsIcon icon={CloudServerIcon} size={16} />
            </button>
          </Tooltip>
        </div>
      ) : (
        <div className="mx-3 mb-3 p-3 rounded-[8px] bg-bg-overlay-tertiary">
          <div className="flex items-center gap-2 mb-2.5">
            <HugeiconsIcon icon={CloudServerIcon} size={15} color="var(--accent-green-primary)" />
            <span className="text-[12px] text-text-primary font-medium whitespace-nowrap">Storage</span>
          </div>
          <div className="h-[4px] bg-bg-field rounded-full overflow-hidden mb-2">
            <div className="h-full bg-accent-green rounded-full transition-all" style={{ width: `${usedPct}%` }} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-tertiary whitespace-nowrap">{usedLabel} of {maxLabel}</span>
            <span className="text-[10px] text-accent-green font-medium cursor-pointer hover:underline whitespace-nowrap">Upgrade</span>
          </div>
        </div>
      )}

      {/* User */}
      <div className={`py-2 transition-all duration-200 ${collapsed ? "px-[10px]" : "px-2"}`}>
        <UserMenu collapsed={collapsed} />
      </div>
    </aside>
  );
}
