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
import MessageMultiple01Icon from "@hugeicons/core-free-icons/MessageMultiple01Icon";
import { useTheme } from "./theme-provider";
import { Tooltip } from "./tooltip";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { SettingsModal } from "./settings-modal";
import { FeedbackModal } from "./feedback-modal";
import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useUserKeys } from "@/hooks/use-user-keys";
import { useFilesContext } from "@/hooks/use-files";
import AnalyticsUpIcon from "@hugeicons/core-free-icons/AnalyticsUpIcon";

function formatStorageBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(size < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function useStorageUsage() {
  // `null` = not yet loaded. The widget should render nothing (or a
  // skeleton) in that state rather than flashing "0 B of 20 GB"
  // which looks like a real value for Free-tier users who just
  // upgraded.
  const [usage, setUsage] = useState<{
    usedBytes: number;
    maxBytes: number;
    fileCount: number;
  } | null>(null);
  useEffect(() => {
    const load = () => {
      fetch("/api/files/usage").then(r => r.json()).then(data => {
        if (data.usedBytes !== undefined) setUsage(data);
      }).catch(() => {});
    };
    load();
    // Refetch on billing changes so the sidebar widget picks up the
    // new tier's maxBytes without a page reload.
    window.addEventListener("securewarp-billing-refresh", load);
    return () => window.removeEventListener("securewarp-billing-refresh", load);
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
  // Which tab the Settings modal should land on the next time it
  // opens. Null means "whatever the modal's default is".
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | null>(null);

  // External callers (quota modal, etc.) open settings via an event.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: string }>).detail;
      if (detail?.tab) setSettingsInitialTab(detail.tab);
      setSettingsOpen(true);
    };
    window.addEventListener("securewarp-open-settings", handler);
    return () => window.removeEventListener("securewarp-open-settings", handler);
  }, []);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [planLabel, setPlanLabel] = useState<string>("Free plan");
  // Refetch the plan label whenever the account dropdown opens (so
  // the user sees the new tier immediately after subscribing) and
  // whenever the app dispatches `securewarp-billing-refresh` from
  // the plan panel after checkout success.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetch("/api/billing/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled) return;
          if (d?.limits?.label) setPlanLabel(`${d.limits.label} plan`);
        })
        .catch(() => {});
    };
    if (open) refresh();
    window.addEventListener("securewarp-billing-refresh", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("securewarp-billing-refresh", refresh);
    };
  }, [open]);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  // Calculate where the dropdown should anchor. Accepts an optional
  // measured height so we can reposition after the menu actually
  // renders and we know its real size — previous versions hard-coded
  // MENU_H and got stale every time a new row was added.
  const updatePos = useCallback((measuredH?: number) => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const MENU_H = measuredH ?? 260;
    const MENU_W = 200;
    const MARGIN = 8;
    const vh = window.innerHeight;

    if (collapsed) {
      // Collapsed: open to the right, bottom-aligned with the button.
      let top = rect.bottom - MENU_H;
      if (top < MARGIN) top = MARGIN;
      if (top + MENU_H > vh - MARGIN) top = vh - MARGIN - MENU_H;
      setPos({ top, left: Math.min(rect.right + MARGIN, window.innerWidth - MENU_W - MARGIN) });
    } else {
      // Expanded: open above the button, left-aligned with it.
      let top = rect.top - MENU_H - MARGIN;
      if (top < MARGIN) top = MARGIN;
      setPos({ top, left: rect.left });
    }
  }, [collapsed]);

  // Once the dropdown mounts, measure its real height and reposition.
  // useLayoutEffect runs before the browser paints, so the user never
  // sees the menu at the wrong position. This handles future rows
  // being added to the menu without anyone remembering to bump MENU_H.
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    updatePos(menuRef.current.offsetHeight);
  }, [open, updatePos]);

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
      <HugeiconsIcon icon={UserCircleIcon} size={18} className="shrink-0" />
      {!collapsed && (
        <span className="text-text-primary text-[12px] font-medium truncate flex-1 min-w-0 text-left">
          {userEmail}
        </span>
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
        <Tooltip label={userEmail} side="bottom">
          <div className="text-[12px] text-text-primary font-medium truncate max-w-full">
            {userEmail}
          </div>
        </Tooltip>
        <div className="text-[11px] text-text-disabled mt-0.5">{planLabel}</div>
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
        <button onClick={() => { setFeedbackOpen(true); setOpen(false); }} className="w-full flex items-center gap-2.5 px-3 h-[32px] text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer">
          <HugeiconsIcon icon={MessageMultiple01Icon} size={15} />
          Send feedback
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
      {collapsed ? (
        <Tooltip label="Account">{button}</Tooltip>
      ) : (
        // Wrap the expanded account button so users with long emails
        // can hover to read the full address when the button truncates.
        <Tooltip label={userEmail} side="right">
          <div className="w-full">{button}</div>
        </Tooltip>
      )}
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
      <SettingsModal
        open={settingsOpen}
        initialTab={settingsInitialTab as never}
        onClose={() => { setSettingsOpen(false); setSettingsInitialTab(null); }}
      />
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
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
  const [activityActive, setActivityActive] = useState(false);

  // Listen for activity show/hide
  useEffect(() => {
    const showHandler = () => setActivityActive(true);
    const hideHandler = () => setActivityActive(false);
    window.addEventListener("securewarp-show-activity", showHandler);
    window.addEventListener("securewarp-hide-activity", hideHandler);
    return () => {
      window.removeEventListener("securewarp-show-activity", showHandler);
      window.removeEventListener("securewarp-hide-activity", hideHandler);
    };
  }, []);

  // Clear activity when workspace changes
  useEffect(() => { setActivityActive(false); }, [fileOps.activeWorkspace]);

  const active = activityActive
    ? "activity"
    : fileOps.viewMode === "trash"
      ? "trash"
      : fileOps.viewMode === "starred"
        ? "starred"
        : fileOps.viewMode === "recent"
          ? "recent"
          : fileOps.viewMode === "shared" ||
              fileOps.breadcrumb[0]?.name === "Shared with me"
            ? "shared"
            : "drive";
  // Pins + labels — IDs fetched once on mount; names resolved reactively.
  const [rawPins, setRawPins] = useState<{ file_id: string; is_folder: boolean }[]>([]);
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
      if (d.pins) setRawPins(d.pins);
    }).catch(() => {});
    fetch("/api/labels").then((r) => r.json()).then((d) => {
      if (d.labels) setLabels(d.labels);
    }).catch(() => {});
  }, []);

  // Re-resolve pin names whenever the file list arrives or changes, so a pin
  // that was unresolvable at sidebar mount (empty fileOps.files, no cache
  // entry — e.g. pinned on another device) fills in as soon as data loads.
  useEffect(() => {
    if (rawPins.length === 0) { setPins([]); return; }
    let nameCache: Record<string, string> = {};
    try { nameCache = JSON.parse(localStorage.getItem("securewarp_pin_names") || "{}"); } catch { /* */ }
    let cacheChanged = false;
    const resolved = rawPins.map((p) => {
      const f = fileOps.files.find((x) => x.id === p.file_id);
      if (f?.name && f.name !== nameCache[p.file_id]) {
        nameCache[p.file_id] = f.name;
        cacheChanged = true;
      }
      const name = f?.name ?? nameCache[p.file_id] ?? (p.is_folder ? "Folder" : "File");
      return { file_id: p.file_id, name, isFolder: p.is_folder };
    });
    if (cacheChanged) {
      try { localStorage.setItem("securewarp_pin_names", JSON.stringify(nameCache)); } catch { /* */ }
    }
    setPins(resolved);
  }, [rawPins, fileOps.files]);

  const storage = useStorageUsage();
  const storageLoaded = storage !== null;
  const usedPct = storageLoaded && storage.maxBytes > 0
    ? Math.min((storage.usedBytes / storage.maxBytes) * 100, 100)
    : 0;
  const usedLabel = storageLoaded ? formatStorageBytes(storage.usedBytes) : "";
  const maxLabel = storageLoaded ? formatStorageBytes(storage.maxBytes) : "";

  const openPlanSettings = () => {
    // UserMenu owns the Settings modal and listens for this event
    // with an optional `tab` detail, so we dispatch instead of
    // trying to reach into its state from here.
    window.dispatchEvent(
      new CustomEvent("securewarp-open-settings", { detail: { tab: "plan" } }),
    );
  };

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
        <span className="text-[11px] text-text-tertiary">
          {storageLoaded ? `${usedLabel} of ${maxLabel}` : "Loading…"}
        </span>
        <button
          onClick={openPlanSettings}
          className="text-[10px] text-accent-green font-medium cursor-pointer hover:underline"
        >
          Upgrade
        </button>
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
          {navItems
            // In a workspace, only show Drive and Trash
            .filter((item) => !fileOps.activeWorkspace || item.id === "drive" || item.id === "trash")
            .map((item) => {
            const handleClick = () => {
              setActivityActive(false);
              window.dispatchEvent(new Event("securewarp-hide-activity"));
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

        {/* Activity (workspace admin only) */}
        {fileOps.activeWorkspace && fileOps.activeWorkspace.role === "admin" && (
          <div className={`mt-3 pt-3 border-t border-border-tertiary ${collapsed ? "flex flex-col items-center" : ""}`}>
            {(() => {
              const btn = (
                <button
                  onClick={() => window.dispatchEvent(new Event("securewarp-show-activity"))}
                  className={`flex items-center rounded-[6px] transition-colors cursor-pointer ${
                    collapsed
                      ? "w-8 h-8 justify-center"
                      : "w-full gap-3 px-2.5 h-[32px] text-[13px]"
                  } ${
                    active === "activity"
                      ? "bg-cta-nav-active text-text-primary font-medium"
                      : "text-text-secondary hover:bg-cta-nav-hover"
                  }`}
                >
                  <HugeiconsIcon icon={AnalyticsUpIcon} size={18} />
                  {!collapsed && <span className="whitespace-nowrap">Activity</span>}
                </button>
              );
              return collapsed ? <Tooltip label="Activity">{btn}</Tooltip> : btn;
            })()}
          </div>
        )}

        {/* Pinned (personal context only) */}
        {!fileOps.activeWorkspace && (collapsed ? (
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
              <div className="flex flex-col gap-[2px] max-h-[240px] overflow-y-auto">
                {pins.slice(0, 10).map((pin) => (
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
        ))}

        {/* Labels (personal context only) */}
        {!fileOps.activeWorkspace && (collapsed ? (
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
              {labels.length < 10 && (
                <button
                  onClick={() => setShowNewLabel(!showNewLabel)}
                  className="p-0.5 rounded text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer"
                >
                  <HugeiconsIcon icon={PlusSignIcon} size={12} />
                </button>
              )}
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
              <div className="flex flex-col gap-[2px] max-h-[240px] overflow-y-auto">
                {labels.slice(0, 10).map((tag) => (
                  <div
                    key={tag.id}
                    className="group w-full flex items-center gap-3 px-2.5 h-[30px] rounded-[6px] text-[12px] text-text-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer"
                  >
                    <button
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent("securewarp-filter-label", { detail: { id: tag.id, name: tag.name, color: tag.color } }));
                      }}
                      className="flex items-center gap-3 flex-1 min-w-0"
                    >
                      <div className="w-[10px] h-[10px] rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                      <span className="whitespace-nowrap truncate">{tag.name}</span>
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await fetch("/api/labels", {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ labelId: tag.id }),
                        });
                        setLabels((prev) => prev.filter((l) => l.id !== tag.id));
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-icon-tertiary hover:text-accent-red transition-all cursor-pointer shrink-0"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
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
            {storageLoaded && (
              <div className="h-full bg-accent-green rounded-full transition-all" style={{ width: `${usedPct}%` }} />
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-tertiary whitespace-nowrap">
              {storageLoaded ? `${usedLabel} of ${maxLabel}` : "Loading…"}
            </span>
            <button
              onClick={openPlanSettings}
              className="text-[10px] text-accent-green font-medium cursor-pointer hover:underline whitespace-nowrap"
            >
              Upgrade
            </button>
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
