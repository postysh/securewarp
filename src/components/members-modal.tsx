"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import { RoleDropdown } from "./role-dropdown";

const WORKSPACE_ROLES = ["Admin", "Editor", "Viewer"] as const;
type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

interface MembersModalProps {
  open: boolean;
  onClose: () => void;
}

type Permission = WorkspaceRole;

interface Member {
  initials: string;
  name: string;
  email: string;
  bg: string;
  permission: Permission;
  online: boolean;
  isOwner?: boolean;
}

const allMembers: Member[] = [
  { initials: "You", name: "You", email: "you@example.com", bg: "var(--accent-green-primary)", permission: "Admin", online: true, isOwner: true },
  { initials: "JD", name: "John Doe", email: "john@example.com", bg: "var(--accent-blue-primary)", permission: "Editor", online: true },
  { initials: "AM", name: "Alice Martin", email: "alice@example.com", bg: "var(--accent-green-primary)", permission: "Editor", online: true },
  { initials: "SK", name: "Sam Kim", email: "sam@example.com", bg: "var(--accent-orange-primary)", permission: "Viewer", online: false },
  { initials: "LW", name: "Lisa Wang", email: "lisa@example.com", bg: "var(--accent-pink-primary)", permission: "Viewer", online: false },
  { initials: "RJ", name: "Ryan Johnson", email: "ryan@example.com", bg: "var(--accent-dark-blue-primary)", permission: "Editor", online: true },
];

export function MembersModal({ open, onClose }: MembersModalProps) {
  const [members, setMembers] = useState(allMembers);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) setSearch("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const updateRole = (email: string, permission: Permission) => {
    setMembers(members.map((m) => m.email === email ? { ...m, permission } : m));
  };

  const removeMember = (email: string) => {
    setMembers(members.filter((m) => m.email !== email));
  };

  const filtered = members.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.email.toLowerCase().includes(search.toLowerCase())
  );

  const onlineCount = members.filter((m) => m.online).length;

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div
        className="relative w-full max-w-[440px] mx-4 rounded-2xl bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in flex flex-col"
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
              <p className="text-[11px] text-text-disabled">{members.length} members, {onlineCount} online</p>
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
              <div key={m.email} className="flex items-center gap-3 px-3 py-2.5 border-b border-border-tertiary last:border-b-0 hover:bg-bg-cell-hover transition-colors">
                {/* Avatar with online dot */}
                <div className="relative shrink-0">
                  <div
                    className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: m.bg }}
                  >
                    {m.initials}
                  </div>
                  {m.online && (
                    <div
                      className="absolute -bottom-0.5 -right-0.5 w-[10px] h-[10px] rounded-full border-2"
                      style={{ backgroundColor: "var(--accent-green-primary)", borderColor: "var(--bg-l3-solid)" }}
                    />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-text-primary truncate">{m.name}</p>
                  <p className="text-[10px] text-text-disabled truncate">{m.email}</p>
                </div>

                {/* Role */}
                {m.isOwner ? (
                  <span className="text-[11px] text-text-disabled px-2">Owner</span>
                ) : (
                  <RoleDropdown<WorkspaceRole>
                    value={m.permission}
                    options={WORKSPACE_ROLES}
                    onChange={(v) => updateRole(m.email, v)}
                    onRemove={() => removeMember(m.email)}
                  />
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
