"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
}

type Permission = "Editor" | "Viewer";

interface Collaborator {
  initials: string;
  name: string;
  email: string;
  bg: string;
  permission: Permission;
  isOwner?: boolean;
}

const existingCollaborators: Collaborator[] = [
  { initials: "You", name: "You", email: "you@example.com", bg: "var(--accent-green-primary)", permission: "Editor", isOwner: true },
];

const suggestedUsers = [
  { initials: "JD", name: "John Doe", email: "john@example.com", bg: "var(--accent-blue-primary)" },
  { initials: "AM", name: "Alice Martin", email: "alice@example.com", bg: "var(--accent-green-primary)" },
  { initials: "SK", name: "Sam Kim", email: "sam@example.com", bg: "var(--accent-orange-primary)" },
  { initials: "LW", name: "Lisa Wang", email: "lisa@example.com", bg: "var(--accent-pink-primary)" },
  { initials: "RJ", name: "Ryan Johnson", email: "ryan@example.com", bg: "var(--accent-dark-blue-primary)" },
];

function PermissionDropdown({ value, onChange, onRemove }: { value: Permission; onChange: (v: Permission) => void; onRemove?: () => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

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
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen(!open);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="flex items-center gap-1 px-2 h-[26px] rounded-[6px] text-[11px] text-text-tertiary hover:bg-bg-cell-hover transition-colors cursor-pointer"
      >
        {value}
        <HugeiconsIcon icon={ArrowDown01Icon} size={10} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed w-[120px] rounded-[8px] bg-bg-l3 border border-border-primary overflow-hidden z-[99999]"
          style={{ top: pos.top, right: pos.right, boxShadow: "var(--shadow-l2)" }}
        >
          <button
            onClick={() => { onChange("Editor"); setOpen(false); }}
            className={`w-full text-left px-3 h-[30px] text-[12px] hover:bg-bg-cell-hover transition-colors cursor-pointer ${value === "Editor" ? "text-text-primary font-medium" : "text-text-secondary"}`}
          >
            Editor
          </button>
          <button
            onClick={() => { onChange("Viewer"); setOpen(false); }}
            className={`w-full text-left px-3 h-[30px] text-[12px] hover:bg-bg-cell-hover transition-colors cursor-pointer ${value === "Viewer" ? "text-text-primary font-medium" : "text-text-secondary"}`}
          >
            Viewer
          </button>
          {onRemove && (
            <>
              <div className="h-px bg-border-tertiary" />
              <button
                onClick={() => { onRemove(); setOpen(false); }}
                className="w-full text-left px-3 h-[30px] text-[12px] text-accent-red hover:bg-bg-cell-hover transition-colors cursor-pointer"
              >
                Remove
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

export function ShareModal({ open, onClose }: ShareModalProps) {
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState("");
  const [collaborators, setCollaborators] = useState<Collaborator[]>(existingCollaborators);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setInputValue("");
      setInputError("");
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

  const addByEmail = (email: string, suggested?: typeof suggestedUsers[0]) => {
    if (!email.trim()) return;
    if (collaborators.find((c) => c.email === email)) {
      setInputError("Already added");
      return;
    }
    const match = suggested || suggestedUsers.find((u) => u.email === email);
    setCollaborators([...collaborators, {
      initials: match?.initials || email.slice(0, 2).toUpperCase(),
      name: match?.name || email,
      email,
      bg: match?.bg || "var(--icon-tertiary)",
      permission: "Viewer",
    }]);
    setInputValue("");
    setInputError("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addByEmail(inputValue);
    }
  };

  const updatePermission = (email: string, permission: Permission) => {
    setCollaborators(collaborators.map((c) => c.email === email ? { ...c, permission } : c));
  };

  const removeCollaborator = (email: string) => {
    setCollaborators(collaborators.filter((c) => c.email !== email));
  };

  const availableSuggestions = suggestedUsers.filter((u) => !collaborators.find((c) => c.email === u.email));

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div
        className="relative w-full max-w-[480px] mx-4 rounded-2xl bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center">
              <HugeiconsIcon icon={UserAdd01Icon} size={18} color="var(--accent-blue-primary)" />
            </div>
            <span className="text-[14px] font-semibold text-text-primary">Invite to workspace</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer">
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {/* Email input */}
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <input
                ref={inputRef}
                type="email"
                value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); setInputError(""); }}
                onKeyDown={handleKeyDown}
                placeholder="Add email"
                className="w-full px-3.5 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40"
              />
              {inputError && <p className="text-[11px] text-accent-red mt-1 px-1">{inputError}</p>}
            </div>
            <button
              onClick={() => addByEmail(inputValue)}
              className="h-[38px] w-[38px] shrink-0 rounded-[10px] bg-bg-field flex items-center justify-center text-icon-secondary hover:bg-bg-field-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={16} />
            </button>
          </div>

          {/* Suggestions */}
          {inputValue && availableSuggestions.filter((u) => u.email.includes(inputValue) || u.name.toLowerCase().includes(inputValue.toLowerCase())).length > 0 && (
            <div className="mt-2 rounded-[10px] border border-border-tertiary overflow-hidden">
              {availableSuggestions
                .filter((u) => u.email.includes(inputValue) || u.name.toLowerCase().includes(inputValue.toLowerCase()))
                .map((u) => (
                <button
                  key={u.email}
                  onClick={() => addByEmail(u.email, u)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-bg-cell-hover transition-colors cursor-pointer"
                >
                  <div className="w-6 h-6 rounded-[5px] flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: u.bg }}>
                    {u.initials}
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-[12px] text-text-primary">{u.name}</span>
                    <span className="text-[10px] text-text-disabled">{u.email}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Collaborator list */}
          <div className="mt-4 rounded-[10px] border border-border-tertiary overflow-hidden">
            {collaborators.map((c) => (
              <div key={c.email} className="flex items-center gap-3 px-3 py-2.5 border-b border-border-tertiary last:border-b-0">
                <div
                  className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                  style={{ backgroundColor: c.bg }}
                >
                  {c.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-text-primary truncate">{c.name}</p>
                  <p className="text-[10px] text-text-disabled truncate">{c.email}</p>
                </div>
                {c.isOwner ? (
                  <span className="text-[11px] text-text-disabled px-2">Owner</span>
                ) : (
                  <PermissionDropdown
                    value={c.permission}
                    onChange={(v) => updatePermission(c.email, v)}
                    onRemove={() => removeCollaborator(c.email)}
                  />
                )}
              </div>
            ))}
          </div>

          {/* E2E note */}
          <div className="flex items-center gap-1.5 mt-4 text-[11px] text-text-disabled">
            <HugeiconsIcon icon={LockIcon} size={12} />
            Members are added with end-to-end encryption
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              onClick={onClose}
              className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={onClose}
              className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer active:scale-[0.98]"
            >
              Invite
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
