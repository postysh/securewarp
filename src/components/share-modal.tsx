"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import { useFilesContext, type DecryptedFile, type Collaborator, type PermissionLevel } from "@/hooks/use-files";
import { initialsFromEmail, colorForEmail } from "@/lib/avatar";
import { RoleDropdown } from "./role-dropdown";

const ROLE_OPTIONS = ["editor", "viewer"] as const satisfies readonly PermissionLevel[];
const ROLE_LABELS: Record<PermissionLevel, string> = {
  editor: "Editor",
  viewer: "Viewer",
};

interface ShareModalProps {
  file: DecryptedFile | null;
  onClose: () => void;
}

export function ShareModal({ file, onClose }: ShareModalProps) {
  const fileOps = useFilesContext();
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loadingCollabs, setLoadingCollabs] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = file !== null;

  useEffect(() => {
    if (!open || !file) return;
    setInputValue("");
    setInputError("");
    setInfo("");
    setLoadingCollabs(true);
    fileOps
      .loadCollaborators(file.id)
      .then((list) => setCollaborators(list))
      .finally(() => setLoadingCollabs(false));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, file, fileOps]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !file) return null;

  const invite = async () => {
    const email = inputValue.trim().toLowerCase();
    if (!email) return;
    if (collaborators.find((c) => c.email.toLowerCase() === email)) {
      setInputError("Already shared with this user");
      return;
    }

    setSubmitting(true);
    setInputError("");
    setInfo("");
    const result = await fileOps.shareFile(file, email);
    setSubmitting(false);

    if (!result.ok) {
      setInputError(result.error);
      return;
    }

    setInputValue("");
    setInfo(`Shared with ${email}`);
    const list = await fileOps.loadCollaborators(file.id);
    setCollaborators(list);
  };

  const removeCollab = async (c: Collaborator) => {
    if (c.isOwner) return;
    const result = await fileOps.unshareFile(file.id, c.userId);
    if (!result.ok) {
      setInputError(result.error);
      return;
    }
    setCollaborators((prev) => prev.filter((x) => x.userId !== c.userId));
    setInfo(`Removed ${c.email}`);
  };

  const changePermission = async (c: Collaborator, level: PermissionLevel) => {
    if (c.isOwner) return;
    if (c.permissionLevel === level) return;
    // Optimistic update — roll back if the API rejects.
    setCollaborators((prev) =>
      prev.map((x) => (x.userId === c.userId ? { ...x, permissionLevel: level } : x))
    );
    const result = await fileOps.setPermission(file.id, c.userId, level);
    if (!result.ok) {
      setInputError(result.error);
      setCollaborators((prev) =>
        prev.map((x) => (x.userId === c.userId ? { ...x, permissionLevel: c.permissionLevel } : x))
      );
      return;
    }
    setInfo(`${c.email} is now a ${level}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!submitting) invite();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div
        className="relative w-full max-w-[480px] mx-4 rounded-2xl bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center shrink-0">
              <HugeiconsIcon icon={UserAdd01Icon} size={18} color="var(--accent-blue-primary)" />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-text-primary truncate">
                {file.isFolder ? "Share folder" : "Share file"}
              </div>
              <div className="text-[11px] text-text-disabled truncate">{file.name}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer shrink-0">
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
                placeholder="Recipient email"
                disabled={submitting}
                className="w-full px-3.5 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40 disabled:opacity-60"
              />
              {inputError && <p className="text-[11px] text-accent-red mt-1 px-1">{inputError}</p>}
              {!inputError && info && <p className="text-[11px] text-accent-green mt-1 px-1">{info}</p>}
            </div>
            <button
              onClick={invite}
              disabled={submitting || !inputValue.trim()}
              className="h-[38px] px-4 shrink-0 rounded-[10px] bg-cta-primary text-text-inverse text-[12px] font-medium hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Sharing..." : "Share"}
            </button>
          </div>

          {/* Collaborator list */}
          <div className="mt-4 rounded-[10px] border border-border-tertiary overflow-hidden">
            {loadingCollabs ? (
              <div className="px-3 py-4 text-center text-[12px] text-text-disabled">Loading…</div>
            ) : collaborators.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-text-disabled">No collaborators yet</div>
            ) : (
              collaborators.map((c) => (
                <div
                  key={c.userId}
                  className="flex items-center gap-3 px-3 py-2.5 border-b border-border-tertiary last:border-b-0"
                >
                  <div
                    className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                    style={{ backgroundColor: colorForEmail(c.email) }}
                  >
                    {initialsFromEmail(c.email)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-text-primary truncate">{c.email || "Unknown user"}</p>
                    <p className="text-[10px] text-text-disabled truncate">
                      {c.isOwner ? "Owner" : c.permissionLevel === "viewer" ? "Can view" : "Can edit"}
                    </p>
                  </div>
                  {c.isOwner ? (
                    <span className="text-[11px] text-text-disabled px-2">Owner</span>
                  ) : (
                    <RoleDropdown<PermissionLevel>
                      value={c.permissionLevel === "owner" ? "editor" : c.permissionLevel}
                      options={ROLE_OPTIONS}
                      labels={ROLE_LABELS}
                      onChange={(v) => changePermission(c, v)}
                      onRemove={() => removeCollab(c)}
                    />
                  )}
                </div>
              ))
            )}
          </div>

          {/* E2E note */}
          <div className="flex items-center gap-1.5 mt-4 text-[11px] text-text-disabled">
            <HugeiconsIcon icon={LockIcon} size={12} />
            The session key is re-wrapped to each recipient&apos;s public key in your browser.
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              onClick={onClose}
              className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
