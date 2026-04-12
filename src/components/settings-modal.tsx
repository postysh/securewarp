"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import UserCircleIcon from "@hugeicons/core-free-icons/UserCircleIcon";
import SecurityLockIcon from "@hugeicons/core-free-icons/SecurityLockIcon";
import PaintBrush01Icon from "@hugeicons/core-free-icons/PaintBrush01Icon";
import CloudServerIcon from "@hugeicons/core-free-icons/CloudServerIcon";
import Notification01Icon from "@hugeicons/core-free-icons/Notification01Icon";
import Sun01Icon from "@hugeicons/core-free-icons/Sun01Icon";
import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import Key02Icon from "@hugeicons/core-free-icons/Key02Icon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import { useTheme } from "./theme-provider";
import { useUserKeys } from "@/hooks/use-user-keys";
import { useAuth } from "@/hooks/use-auth";
import { RecoveryKeyModal } from "./recovery-key-modal";
import { ConfirmDialog } from "./confirm-dialog";
import { clearLockCache } from "@/lib/auth/lock-cache";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type TabId = "account" | "security" | "appearance" | "notifications" | "storage";

const tabs: { id: TabId; label: string; icon: unknown; section?: string }[] = [
  { id: "account", label: "Account", icon: UserCircleIcon, section: "General" },
  { id: "security", label: "Security", icon: SecurityLockIcon, section: "General" },
  { id: "appearance", label: "Appearance", icon: PaintBrush01Icon, section: "General" },
  { id: "notifications", label: "Notifications", icon: Notification01Icon, section: "General" },
  { id: "storage", label: "Storage", icon: CloudServerIcon, section: "Plan" },
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>("account");
  const { theme, toggle: toggleTheme } = useTheme();
  const [changingPassword, setChangingPassword] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwStatus, setPwStatus] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [storageUsage, setStorageUsage] = useState<{
    usedBytes: number; maxBytes: number;
    filesBytes: number; filesCount: number;
    trashBytes: number; trashCount: number;
    sharedCount: number;
  } | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({
    file_shared: true,
    file_unshared: true,
    permission_changed: true,
  });
  const [profileLoaded, setProfileLoaded] = useState(false);
  const userKeys = useUserKeys();
  const auth = useAuth();

  const email = userKeys?.email || "";
  const initials = displayName
    ? displayName.charAt(0).toUpperCase()
    : email
      ? email.charAt(0).toUpperCase()
      : "?";

  useEffect(() => {
    if (open) {
      setActiveTab("account");
      setChangingPassword(false);
      setNewPw("");
      setConfirmPw("");
      setPwStatus(null);
      setShowKeys(false);
      setEditingName(false);
      if (!profileLoaded) {
        fetch("/api/auth/profile")
          .then((r) => r.json())
          .then((d) => {
            if (d.displayName !== undefined) setDisplayName(d.displayName);
            if (d.notificationPrefs) setNotifPrefs(d.notificationPrefs);
            setProfileLoaded(true);
          })
          .catch(() => {});
      }
    }
  }, [open, profileLoaded]);

  useEffect(() => {
    if (open && activeTab === "storage" && !storageUsage) {
      fetch("/api/files/usage")
        .then((r) => r.json())
        .then((d) => {
          if (d.usedBytes !== undefined) setStorageUsage(d);
        })
        .catch(() => {});
    }
  }, [open, activeTab, storageUsage]);

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
              <span className="text-[12px] text-text-secondary font-mono">{email}</span>
            </SettingRow>
            <SettingRow label="Display name" description="Visible to collaborators">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Your name"
                    autoFocus
                    className="w-[160px] px-2 py-1.5 rounded-[6px] bg-bg-field text-[12px] text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-green/25 border border-transparent focus:border-accent-green/40"
                  />
                  <button
                    onClick={async () => {
                      await fetch("/api/auth/profile", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ displayName: nameInput }),
                      });
                      setDisplayName(nameInput.trim());
                      setEditingName(false);
                    }}
                    className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingName(false)}
                    className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-text-secondary">{displayName || "Not set"}</span>
                  <button
                    onClick={() => { setNameInput(displayName); setEditingName(true); }}
                    className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer"
                  >
                    Edit
                  </button>
                </div>
              )}
            </SettingRow>
            <div className="py-4 border-b border-border-tertiary">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <p className="text-[13px] text-text-primary">Change password</p>
                  <p className="text-[11px] text-text-disabled mt-0.5">Re-encrypts your private keys with the new password</p>
                </div>
                {!changingPassword && (
                  <button onClick={() => setChangingPassword(true)} className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer">
                    Change
                  </button>
                )}
              </div>
              {changingPassword && (
                <div className="mt-3 space-y-2 animate-fade-in">
                  {pwStatus && <p className="text-[11px] text-accent-green">{pwStatus}</p>}
                  {auth.error && <p className="text-[11px] text-accent-red">{auth.error}</p>}
                  <input type="password" placeholder="New password (min 8 characters)" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="w-full px-3 py-2 rounded-[8px] bg-bg-field text-[12px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 border border-transparent focus:border-accent-green/40" />
                  <input type="password" placeholder="Confirm new password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} className="w-full px-3 py-2 rounded-[8px] bg-bg-field text-[12px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 border border-transparent focus:border-accent-green/40" />
                  {newPw && confirmPw && newPw !== confirmPw && <p className="text-[11px] text-accent-red">Passwords don&apos;t match</p>}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => { setChangingPassword(false); setNewPw(""); setConfirmPw(""); setPwStatus(null); }} className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer">Cancel</button>
                    <button
                      disabled={!newPw || newPw.length < 8 || newPw !== confirmPw || auth.loading}
                      onClick={async () => {
                        setPwStatus("Changing password...");
                        await auth.changePassword("", newPw, email);
                        if (!auth.error) {
                          setPwStatus("Password changed. New recovery key generated.");
                          setNewPw("");
                          setConfirmPw("");
                          setChangingPassword(false);
                        }
                      }}
                      className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {auth.loading ? (auth.step || "Processing...") : "Update password"}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <SettingRow label="Delete account" description="Permanently delete your account and all data">
              <button
                onClick={() => setDeleteOpen(true)}
                className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-accent-red hover:bg-accent-red/10 border border-accent-red/20 transition-colors cursor-pointer"
              >
                Delete
              </button>
            </SettingRow>
            <ConfirmDialog
              open={deleteOpen}
              title="Delete your account?"
              description="This will permanently delete your account, all files, shared access, and encryption keys. This cannot be undone."
              confirmLabel="Delete account"
              destructive
              busy={deleteBusy}
              busyLabel="Deleting…"
              onConfirm={async () => {
                setDeleteBusy(true);
                try {
                  const res = await fetch("/api/auth/delete-account", { method: "POST" });
                  if (res.ok) {
                    clearLockCache();
                    sessionStorage.clear();
                    window.location.href = "/signup";
                  } else {
                    setDeleteBusy(false);
                  }
                } catch {
                  setDeleteBusy(false);
                }
              }}
              onCancel={() => !deleteBusy && setDeleteOpen(false)}
            />
          </div>
        );
      case "security":
        return (
          <div>
            <SettingRow label="Recovery key" description="Your 24-word recovery phrase was shown at signup and after password changes">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-[11px] text-accent-green"><HugeiconsIcon icon={Shield01Icon} size={12} /> Generated</span>
                <span className="text-[10px] text-text-disabled">Shown once at creation</span>
              </div>
            </SettingRow>
            <SettingRow label="Encryption keys" description="Your public keys for verification by collaborators">
              <button
                onClick={() => setShowKeys(!showKeys)}
                className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer"
              >
                {showKeys ? "Hide" : "View keys"}
              </button>
            </SettingRow>
            {showKeys && userKeys && (
              <div className="py-3 space-y-3 animate-fade-in">
                <div>
                  <p className="text-[10px] font-mono uppercase text-text-disabled tracking-wider mb-1">Encryption public key</p>
                  <div className="px-3 py-2 rounded-[8px] bg-bg-field">
                    <p className="text-[11px] font-mono text-text-secondary break-all select-all">{userKeys.encryptionPublicKey}</p>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase text-text-disabled tracking-wider mb-1">Signing public key</p>
                  <div className="px-3 py-2 rounded-[8px] bg-bg-field">
                    <p className="text-[11px] font-mono text-text-secondary break-all select-all">{userKeys.signingPublicKey}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-text-disabled">
                  <HugeiconsIcon icon={LockIcon} size={10} />
                  Private keys never leave your browser
                </div>
              </div>
            )}
            <SettingRow label="Zero-knowledge architecture" description="Your data is encrypted client-side before it reaches our servers">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-[11px] text-accent-green"><HugeiconsIcon icon={Shield01Icon} size={12} /> Active</span>
              </div>
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
          </div>
        );
      case "notifications": {
        const togglePref = async (key: string) => {
          const newVal = !notifPrefs[key];
          setNotifPrefs((p) => ({ ...p, [key]: newVal }));
          await fetch("/api/auth/profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notificationPrefs: { [key]: newVal } }),
          });
        };
        return (
          <div>
            <SettingRow label="File shared" description="When someone shares a file or folder with you">
              <Toggle checked={notifPrefs.file_shared !== false} onChange={() => togglePref("file_shared")} />
            </SettingRow>
            <SettingRow label="Access removed" description="When your access to a file is revoked">
              <Toggle checked={notifPrefs.file_unshared !== false} onChange={() => togglePref("file_unshared")} />
            </SettingRow>
            <SettingRow label="Permission changed" description="When your permission level is updated">
              <Toggle checked={notifPrefs.permission_changed !== false} onChange={() => togglePref("permission_changed")} />
            </SettingRow>
          </div>
        );
      }
      case "storage": {
        const used = storageUsage?.usedBytes ?? 0;
        const max = storageUsage?.maxBytes ?? 20 * 1024 * 1024 * 1024;
        const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
        const filesBytes = storageUsage?.filesBytes ?? 0;
        const trashBytes = storageUsage?.trashBytes ?? 0;
        const filesPct = max > 0 ? (filesBytes / max) * 100 : 0;
        const trashPct = max > 0 ? (trashBytes / max) * 100 : 0;
        const categories = [
          { label: "Files", size: formatBytes(filesBytes), count: storageUsage?.filesCount ?? 0, percent: filesPct, color: "var(--accent-blue-primary)" },
          { label: "Shared with me", size: `${storageUsage?.sharedCount ?? 0} files`, count: storageUsage?.sharedCount ?? 0, percent: 0, color: "var(--accent-green-primary)" },
          { label: "Trash", size: formatBytes(trashBytes), count: storageUsage?.trashCount ?? 0, percent: trashPct, color: "var(--accent-red-primary)" },
        ];
        return (
          <div>
            <div className="p-4 rounded-[10px] bg-bg-overlay-tertiary mb-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[14px] text-text-primary font-semibold">Free plan</p>
                  <p className="text-[11px] text-text-disabled mt-0.5">{formatBytes(max)} storage included</p>
                </div>
              </div>
              <div className="h-[8px] bg-bg-field rounded-full overflow-hidden flex">
                {categories.filter((c) => c.percent > 0).map((cat) => (
                  <div
                    key={cat.label}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                    style={{ width: `${cat.percent}%`, backgroundColor: cat.color }}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[12px] text-text-primary font-medium">{formatBytes(used)} used</span>
                <span className="text-[11px] text-text-disabled">of {formatBytes(max)}</span>
              </div>
            </div>

            <p className="text-[10px] font-mono uppercase text-text-disabled tracking-wider mb-2">Breakdown</p>
            <div className="rounded-[10px] border border-border-tertiary overflow-hidden">
              {categories.map((cat) => (
                <div key={cat.label} className="flex items-center gap-3 px-3 py-3 border-b border-border-tertiary last:border-b-0">
                  <div className="w-[10px] h-[10px] rounded-[3px]" style={{ backgroundColor: cat.color }} />
                  <div className="flex-1">
                    <p className="text-[12px] text-text-primary">{cat.label}</p>
                    <p className="text-[10px] text-text-disabled">{cat.count} items</p>
                  </div>
                  <span className="text-[12px] text-text-secondary font-mono">{cat.size}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-1.5 mt-4 text-[10px] text-text-disabled">
              <HugeiconsIcon icon={LockIcon} size={10} />
              Storage usage is calculated from encrypted file sizes
            </div>
          </div>
        );
      }
    }
  };

  const modal = createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div
        className="relative w-full max-w-[720px] mx-4 rounded-2xl bg-bg-l2 border border-border-primary overflow-hidden animate-fade-in flex"
        style={{ boxShadow: "var(--shadow-l2)", height: "55vh", minHeight: 420 }}
      >
        {/* Sidebar */}
        <div className="w-[200px] shrink-0 bg-bg-side border-r border-border-tertiary flex flex-col overflow-y-auto">
          <div
            onClick={() => setActiveTab("account")}
            className={`flex items-center gap-3 px-3 py-3 mx-2 mt-2 rounded-[6px] cursor-pointer transition-colors ${activeTab === "account" ? "bg-bg-overlay-tertiary" : "hover:bg-bg-overlay-tertiary"}`}
          >
            <div className="w-8 h-8 rounded-[6px] bg-accent-green flex items-center justify-center text-[11px] font-bold text-white shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-[12px] text-text-primary font-medium truncate">{displayName || email.split("@")[0]}</p>
              <p className="text-[10px] text-text-disabled truncate">{email}</p>
            </div>
          </div>

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
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-tertiary shrink-0">
            <h3 className="text-[16px] font-semibold text-text-primary capitalize">{activeTab}</h3>
            <button onClick={onClose} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer">
              <HugeiconsIcon icon={Cancel01Icon} size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-2">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );

  return (
    <>
      {modal}
      {auth.recoveryKey && (
        <RecoveryKeyModal open={true} onClose={auth.dismissRecoveryKey} recoveryKey={auth.recoveryKey} />
      )}
    </>
  );
}
