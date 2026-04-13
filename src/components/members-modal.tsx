"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import { RoleDropdown } from "./role-dropdown";
import { colorForEmail } from "./facepile";

const WORKSPACE_ROLES = ["admin", "editor", "viewer"] as const;
const ROLE_LABELS: Record<string, string> = { admin: "Admin", editor: "Editor", viewer: "Viewer" };

interface MembersModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null;
  isAdmin: boolean;
}

interface Member {
  userId: string;
  email: string;
  role: string;
}

export function MembersModal({ open, onClose, workspaceId, isAdmin }: MembersModalProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const myEmail = (() => { try { return JSON.parse(sessionStorage.getItem("securewarp_keys") || "{}").email || ""; } catch { return ""; } })();
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open || !workspaceId) return;
    setSearch("");
    fetch(`/api/workspaces/members?workspaceId=${workspaceId}`)
      .then((r) => r.json())
      .then((d) => { if (d.members) setMembers(d.members); })
      .catch(() => {});
  }, [open, workspaceId]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const changeRole = async (userId: string, role: string) => {
    await fetch("/api/workspaces/change-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, userId, role }),
    });
    setMembers((prev) => prev.map((m) => m.userId === userId ? { ...m, role } : m));
  };

  const removeMember = async (userId: string) => {
    await fetch("/api/workspaces/remove-member", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, userId }),
    });
    setMembers((prev) => prev.filter((m) => m.userId !== userId));
  };

  const filtered = members.filter((m) =>
    m.email.toLowerCase().includes(search.toLowerCase())
  );

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        role="dialog" aria-modal="true" aria-label="Members"
        className="relative w-full h-full md:h-auto max-w-none md:max-w-[440px] mx-0 md:mx-4 rounded-none md:rounded-2xl bg-bg-l3 border-0 md:border border-border-primary overflow-hidden animate-fade-in flex flex-col"
        style={{ boxShadow: "var(--shadow-l2)", maxHeight: "80vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center">
              <HugeiconsIcon icon={UserGroupIcon} size={18} color="var(--accent-blue-primary)" />
            </div>
            <div>
              <span className="text-[14px] font-semibold text-text-primary">Members</span>
              <p className="text-[11px] text-text-disabled">{members.length} members</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer">
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 shrink-0">
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-icon-tertiary">
              <HugeiconsIcon icon={Search01Icon} size={14} />
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members"
              className="w-full pl-9 pr-4 py-2 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40"
            />
          </div>
        </div>

        {/* Member list */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          <div className="rounded-[10px] border border-border-tertiary overflow-hidden">
            {filtered.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 px-3 py-2.5 border-b border-border-tertiary last:border-b-0 hover:bg-bg-cell-hover transition-colors">
                <div className="relative shrink-0">
                  <div
                    className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: colorForEmail(m.email) }}
                  >
                    {m.email.charAt(0).toUpperCase()}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-text-primary truncate">{m.email}</p>
                  <p className="text-[10px] text-text-disabled capitalize">{ROLE_LABELS[m.role] ?? m.role}</p>
                </div>
                {isAdmin && m.email !== myEmail ? (
                  <RoleDropdown
                    value={m.role}
                    options={WORKSPACE_ROLES}
                    labels={ROLE_LABELS}
                    onChange={(v) => changeRole(m.userId, v)}
                    onRemove={() => removeMember(m.userId)}
                  />
                ) : (
                  <span className="text-[11px] text-text-disabled px-2 capitalize">{ROLE_LABELS[m.role] ?? m.role}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border-tertiary shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer active:scale-[0.98]"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
