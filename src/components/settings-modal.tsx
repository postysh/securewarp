"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Setting07Icon from "@hugeicons/core-free-icons/Setting07Icon";
import UserCircleIcon from "@hugeicons/core-free-icons/UserCircleIcon";
import SecurityLockIcon from "@hugeicons/core-free-icons/SecurityLockIcon";
import PaintBrush01Icon from "@hugeicons/core-free-icons/PaintBrush01Icon";
import CloudServerIcon from "@hugeicons/core-free-icons/CloudServerIcon";
import GoogleDriveIcon from "@hugeicons/core-free-icons/GoogleDriveIcon";
import Notification01Icon from "@hugeicons/core-free-icons/Notification01Icon";
import Sun01Icon from "@hugeicons/core-free-icons/Sun01Icon";
import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import Key02Icon from "@hugeicons/core-free-icons/Key02Icon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import { useTheme } from "./theme-provider";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type TabId = "account" | "security" | "appearance" | "notifications" | "storage" | "import";

const tabs: { id: TabId; label: string; icon: unknown; section?: string }[] = [
  { id: "account", label: "Account", icon: UserCircleIcon, section: "General" },
  { id: "security", label: "Security", icon: SecurityLockIcon, section: "General" },
  { id: "appearance", label: "Appearance", icon: PaintBrush01Icon, section: "General" },
  { id: "notifications", label: "Notifications", icon: Notification01Icon, section: "General" },
  { id: "storage", label: "Storage", icon: CloudServerIcon, section: "Plan" },
  { id: "import", label: "Import & Export", icon: GoogleDriveIcon, section: "Data" },
];

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-border-tertiary last:border-b-0">
      <div className="min-w-0 mr-4">
        <p className="text-[13px] text-text-primary">{label}</p>
        {description && <p className="text-[11px] text-text-disabled mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`w-[36px] h-[20px] rounded-full transition-colors cursor-pointer ${checked ? "bg-accent-green" : "bg-bg-field"}`}
    >
      <div className={`w-[16px] h-[16px] rounded-full bg-white transition-transform mx-[2px] ${checked ? "translate-x-[16px]" : ""}`} style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
    </button>
  );
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>("account");
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    if (open) setActiveTab("account");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const sections = [...new Set(tabs.map((t) => t.section))];

  const renderContent = () => {
    switch (activeTab) {
      case "account":
        return (
          <div>
            <SettingRow label="Email" description="Your account email address">
              <span className="text-[12px] text-text-secondary">you@example.com</span>
            </SettingRow>
            <SettingRow label="Display name" description="Visible to collaborators">
              <button className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer">
                Edit
              </button>
            </SettingRow>
            <SettingRow label="Change password" description="Re-encrypts your private keys with the new password">
              <button className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer">
                Change
              </button>
            </SettingRow>
            <SettingRow label="Delete account" description="Permanently delete your account and all data">
              <button className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-accent-red hover:bg-accent-red/10 border border-accent-red/20 transition-colors cursor-pointer">
                Delete
              </button>
            </SettingRow>
          </div>
        );
      case "security":
        return (
          <div>
            <SettingRow label="Recovery key" description="Download your account recovery key">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-[11px] text-accent-green"><HugeiconsIcon icon={Shield01Icon} size={12} /> Enabled</span>
                <button className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer">
                  View
                </button>
              </div>
            </SettingRow>
            <SettingRow label="Two-factor authentication" description="Add an extra layer of security with TOTP">
              <Toggle checked={false} onChange={() => {}} />
            </SettingRow>
            <SettingRow label="Active sessions" description="Manage devices logged into your account">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-text-disabled">2 devices</span>
                <button className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer">
                  Manage
                </button>
              </div>
            </SettingRow>
            <SettingRow label="Encryption keys" description="View your public encryption and signing keys">
              <button className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer">
                View keys
              </button>
            </SettingRow>
          </div>
        );
      case "appearance":
        return (
          <div>
            <SettingRow label="Theme" description="Choose your preferred color scheme">
              <div className="flex items-center gap-1 rounded-[8px] bg-bg-field p-0.5">
                {[
                  { id: "light", icon: Sun01Icon, label: "Light" },
                  { id: "dark", icon: Moon02Icon, label: "Dark" },
                  { id: "system", icon: ComputerIcon, label: "System" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => { if (opt.id === "light" && theme === "dark") toggleTheme(); if (opt.id === "dark" && theme === "light") toggleTheme(); }}
                    className={`flex items-center gap-1.5 h-[26px] px-2.5 rounded-[6px] text-[11px] font-medium transition-colors cursor-pointer ${
                      (opt.id === theme) ? "bg-bg-l3 text-text-primary" : "text-text-tertiary hover:text-text-secondary"
                    }`}
                    style={(opt.id === theme) ? { boxShadow: "var(--shadow-l1)" } : {}}
                  >
                    <HugeiconsIcon icon={opt.icon} size={12} />
                    {opt.label}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow label="Compact mode" description="Reduce spacing for denser file views">
              <Toggle checked={false} onChange={() => {}} />
            </SettingRow>
            <SettingRow label="Show file extensions" description="Display extensions in file names">
              <Toggle checked={true} onChange={() => {}} />
            </SettingRow>
          </div>
        );
      case "notifications":
        return (
          <div>
            <SettingRow label="Shared with me" description="When someone shares a file or folder">
              <Toggle checked={true} onChange={() => {}} />
            </SettingRow>
            <SettingRow label="Upload complete" description="When a file upload finishes">
              <Toggle checked={true} onChange={() => {}} />
            </SettingRow>
            <SettingRow label="Link accessed" description="When someone views a shared link">
              <Toggle checked={false} onChange={() => {}} />
            </SettingRow>
            <SettingRow label="Team activity" description="When members join or leave workspace">
              <Toggle checked={true} onChange={() => {}} />
            </SettingRow>
          </div>
        );
      case "storage": {
        const categories = [
          { label: "Files", size: "1.8 GB", percent: 78, color: "var(--accent-blue-primary)" },
          { label: "Shared", size: "420 MB", percent: 18, color: "var(--accent-green-primary)" },
          { label: "Trash", size: "80 MB", percent: 4, color: "var(--accent-red-primary)" },
        ];
        return (
          <div>
            {/* Plan card */}
            <div className="p-4 rounded-[10px] bg-bg-overlay-tertiary mb-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[14px] text-text-primary font-semibold">Free plan</p>
                  <p className="text-[11px] text-text-disabled mt-0.5">10 GB storage included</p>
                </div>
                <button className="h-[30px] px-4 rounded-[8px] text-[12px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-opacity cursor-pointer active:scale-[0.98]">
                  Upgrade
                </button>
              </div>

              {/* Stacked bar */}
              <div className="h-[8px] bg-bg-field rounded-full overflow-hidden flex">
                {categories.map((cat) => (
                  <div
                    key={cat.label}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                    style={{ width: `${cat.percent}%`, backgroundColor: cat.color }}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between mt-2">
                <span className="text-[12px] text-text-primary font-medium">2.3 GB used</span>
                <span className="text-[11px] text-text-disabled">of 10 GB</span>
              </div>
            </div>

            {/* Breakdown */}
            <p className="text-[10px] font-mono uppercase text-text-disabled tracking-wider mb-2">Breakdown</p>
            <div className="rounded-[10px] border border-border-tertiary overflow-hidden">
              {categories.map((cat) => (
                <div key={cat.label} className="flex items-center gap-3 px-3 py-3 border-b border-border-tertiary last:border-b-0">
                  <div className="w-[10px] h-[10px] rounded-[3px]" style={{ backgroundColor: cat.color }} />
                  <div className="flex-1">
                    <p className="text-[12px] text-text-primary">{cat.label}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-text-secondary font-mono">{cat.size}</span>
                    <div className="w-[60px] h-[4px] bg-bg-field rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${cat.percent}%`, backgroundColor: cat.color }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      }
      case "import":
        return (
          <div>
            <SettingRow label="Import from Google Drive" description="Migrate files with client-side encryption">
              <button className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer flex items-center gap-1.5">
                <HugeiconsIcon icon={GoogleDriveIcon} size={12} />
                Connect
              </button>
            </SettingRow>
            <SettingRow label="Export all data" description="Download all your decrypted files as a zip archive">
              <button className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer">
                Export
              </button>
            </SettingRow>
          </div>
        );
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div
        className="relative w-full max-w-[720px] mx-4 rounded-2xl bg-bg-l2 border border-border-primary overflow-hidden animate-fade-in flex"
        style={{ boxShadow: "var(--shadow-l2)", height: "55vh", minHeight: 420 }}
      >
        {/* Sidebar */}
        <div className="w-[200px] shrink-0 bg-bg-side border-r border-border-tertiary flex flex-col overflow-y-auto">
          {/* Account avatar */}
          <div
            onClick={() => setActiveTab("account")}
            className={`flex items-center gap-3 px-3 py-3 mx-2 mt-2 rounded-[6px] cursor-pointer transition-colors ${activeTab === "account" ? "bg-bg-overlay-tertiary" : "hover:bg-bg-overlay-tertiary"}`}
          >
            <div className="w-8 h-8 rounded-[6px] bg-accent-green flex items-center justify-center text-[11px] font-bold text-white shrink-0">
              Y
            </div>
            <div className="min-w-0">
              <p className="text-[12px] text-text-primary font-medium truncate">You</p>
              <p className="text-[10px] text-text-disabled truncate">you@example.com</p>
            </div>
          </div>

          {/* Tab sections */}
          <div className="flex-1 px-2 py-2">
            {sections.map((section) => (
              <div key={section} className="mb-2">
                <p className="text-[10px] font-mono uppercase text-text-disabled tracking-wider px-2 py-1.5">{section}</p>
                <div className="flex flex-col gap-[2px]">
                  {tabs.filter((t) => t.section === section && t.id !== "account").map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`w-full flex items-center gap-2.5 px-2 h-[32px] rounded-[6px] text-[12px] transition-colors cursor-pointer ${
                        activeTab === tab.id
                          ? "bg-bg-overlay-tertiary text-text-primary font-medium"
                          : "text-text-secondary hover:bg-bg-overlay-tertiary"
                      }`}
                    >
                      <HugeiconsIcon icon={tab.icon as Parameters<typeof HugeiconsIcon>[0]["icon"]} size={15} />
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-tertiary shrink-0">
            <h3 className="text-[16px] font-semibold text-text-primary capitalize">{activeTab === "import" ? "Import & Export" : activeTab}</h3>
            <button onClick={onClose} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer">
              <HugeiconsIcon icon={Cancel01Icon} size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-2">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
