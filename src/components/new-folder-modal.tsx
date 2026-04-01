"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";

interface NewFolderModalProps {
  open: boolean;
  onClose: () => void;
}

const suggestedMembers = [
  { initials: "JD", name: "John Doe", email: "john@example.com", bg: "var(--accent-blue-primary)" },
  { initials: "AM", name: "Alice Martin", email: "alice@example.com", bg: "var(--accent-green-primary)" },
  { initials: "SK", name: "Sam Kim", email: "sam@example.com", bg: "var(--accent-orange-primary)" },
];

export function NewFolderModal({ open, onClose }: NewFolderModalProps) {
  const [name, setName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [addedMembers, setAddedMembers] = useState<typeof suggestedMembers>([]);
  const [showMembers, setShowMembers] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setMemberEmail("");
      setAddedMembers([]);
      setShowMembers(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onClose();
  };

  const addMember = (member: typeof suggestedMembers[0]) => {
    if (!addedMembers.find((m) => m.email === member.email)) {
      setAddedMembers([...addedMembers, member]);
    }
    setMemberEmail("");
  };

  const removeMember = (email: string) => {
    setAddedMembers(addedMembers.filter((m) => m.email !== email));
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={onClose} />

      {/* Modal */}
      <div
        className="relative w-full max-w-[440px] mx-4 rounded-2xl bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center">
              <HugeiconsIcon icon={Folder01Icon} size={18} color="var(--accent-blue-primary)" />
            </div>
            <span className="text-[14px] font-semibold text-text-primary">New folder</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer">
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-5 py-5">
          {/* Folder name */}
          <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">
            Folder name
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled folder"
            className="w-full px-3.5 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40"
          />

          {/* Add members toggle */}
          {!showMembers ? (
            <button
              type="button"
              onClick={() => setShowMembers(true)}
              className="flex items-center gap-2 mt-4 text-[12px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={UserGroupIcon} size={14} />
              Add members
            </button>
          ) : (
            <div className="mt-4">
              <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">
                Members
              </label>

              {/* Added members */}
              {addedMembers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {addedMembers.map((m) => (
                    <div key={m.email} className="flex items-center gap-1.5 h-[26px] pl-1 pr-2 rounded-[6px] bg-bg-overlay-tertiary">
                      <div
                        className="w-[18px] h-[18px] rounded-[4px] flex items-center justify-center text-[8px] font-bold text-white"
                        style={{ backgroundColor: m.bg }}
                      >
                        {m.initials}
                      </div>
                      <span className="text-[11px] text-text-secondary">{m.name}</span>
                      <button
                        type="button"
                        onClick={() => removeMember(m.email)}
                        className="text-icon-tertiary hover:text-text-secondary transition-colors cursor-pointer ml-0.5"
                      >
                        <HugeiconsIcon icon={Cancel01Icon} size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Email input */}
              <div className="relative">
                <input
                  type="email"
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  placeholder="Add by email"
                  className="w-full px-3.5 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40"
                />
              </div>

              {/* Suggested members */}
              {suggestedMembers.filter((m) => !addedMembers.find((a) => a.email === m.email)).length > 0 && (
                <div className="mt-2.5">
                  <span className="text-[10px] text-text-disabled uppercase tracking-wider font-mono">Suggested</span>
                  <div className="mt-1.5 flex flex-col gap-0.5">
                    {suggestedMembers
                      .filter((m) => !addedMembers.find((a) => a.email === m.email))
                      .map((m) => (
                      <button
                        key={m.email}
                        type="button"
                        onClick={() => addMember(m)}
                        className="flex items-center gap-2.5 px-2 py-1.5 rounded-[6px] hover:bg-bg-cell-hover transition-colors cursor-pointer"
                      >
                        <div
                          className="w-6 h-6 rounded-[5px] flex items-center justify-center text-[9px] font-bold text-white"
                          style={{ backgroundColor: m.bg }}
                        >
                          {m.initials}
                        </div>
                        <div className="flex flex-col items-start">
                          <span className="text-[12px] text-text-primary">{m.name}</span>
                          <span className="text-[10px] text-text-disabled">{m.email}</span>
                        </div>
                        <div className="ml-auto">
                          <HugeiconsIcon icon={PlusSignIcon} size={12} color="var(--icon-tertiary)" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* E2E note */}
          <div className="flex items-center gap-1.5 mt-4 text-[11px] text-text-disabled">
            <HugeiconsIcon icon={LockIcon} size={12} />
            Folder will be end-to-end encrypted
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={onClose}
              className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
