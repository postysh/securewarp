"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import { RoleDropdown } from "./role-dropdown";
import {
  unwrapPrivateHierarchicalKey,
  wrapPrivateHierarchicalKeyForUser,
} from "@/lib/crypto/file-crypto";

interface WorkspaceInviteModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null;
  rootFolderId: string | null;
  defaultRole?: "admin" | "editor" | "viewer";
}

const ROLES = ["editor", "viewer", "admin"] as const;
const ROLE_LABELS: Record<string, string> = { editor: "Editor", viewer: "Viewer", admin: "Admin" };

export function WorkspaceInviteModal({ open, onClose, workspaceId, rootFolderId, defaultRole = "editor" }: WorkspaceInviteModalProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setEmail(""); setError(null); setSuccess(null); setRole(defaultRole); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, busy]);

  if (!open || !workspaceId || !rootFolderId) return null;

  const handleInvite = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const lookupRes = await fetch(`/api/users/lookup?email=${encodeURIComponent(email.trim())}`);
      const lookupData = await lookupRes.json();
      if (!lookupRes.ok) { setError(lookupData.error || "User not found"); setBusy(false); return; }

      const keysStr = sessionStorage.getItem("securewarp_keys");
      if (!keysStr) { setError("Not signed in"); setBusy(false); return; }
      const keys = JSON.parse(keysStr) as {
        encryptionPublicKey: string;
        encryptionPrivateKey: string;
        kemPublicKey: string;
        kemPrivateKey: string;
      };

      const dlRes = await fetch(`/api/files/chunk-download?fileId=${rootFolderId}`);
      const dlData = await dlRes.json();
      if (!dlRes.ok) { setError("Failed to load workspace keys"); setBusy(false); return; }

      const privHier = unwrapPrivateHierarchicalKey(
        dlData.encryptedPrivateHierarchicalKey,
        dlData.wrappedByPublicKey,
        keys.encryptionPrivateKey,
        keys.kemPrivateKey,
      );
      const wrapped = wrapPrivateHierarchicalKeyForUser(
        privHier,
        { x25519: lookupData.publicEncryptionKey, kem: lookupData.publicKemKey },
        keys.encryptionPrivateKey,
      );

      const res = await fetch("/api/workspaces/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          email: email.trim(),
          role,
          encryptedPrivateHierarchicalKey: wrapped,
          wrappedByPublicKey: keys.encryptionPublicKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Invite failed"); setBusy(false); return; }

      setSuccess(`Invited ${email.trim()} as ${ROLE_LABELS[role]}`);
      setEmail("");
    } catch {
      setError("Invite failed");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={() => !busy && onClose()} />
      <div
        role="dialog" aria-modal="true" aria-label="Invite to workspace"
        className="relative w-full h-full md:h-auto max-w-none md:max-w-[420px] mx-0 md:mx-4 rounded-none md:rounded-2xl bg-bg-l3 border-0 md:border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center">
              <HugeiconsIcon icon={UserAdd01Icon} size={18} color="var(--accent-green-primary)" />
            </div>
            <span className="text-[14px] font-semibold text-text-primary">Invite to workspace</span>
          </div>
          {!busy && (
            <button onClick={onClose} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer">
              <HugeiconsIcon icon={Cancel01Icon} size={16} />
            </button>
          )}
        </div>

        <div className="px-5 py-5">
          <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">Email</label>
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null); setSuccess(null); }}
              placeholder="colleague@example.com"
              disabled={busy}
              autoFocus
              className="flex-1 px-3.5 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 border border-transparent focus:border-accent-green/40 disabled:opacity-50"
              onKeyDown={(e) => { if (e.key === "Enter") handleInvite(); }}
            />
            <RoleDropdown
              value={role}
              options={ROLES}
              labels={ROLE_LABELS}
              onChange={(v) => setRole(v as "admin" | "editor" | "viewer")}
              disabled={busy}
            />
          </div>

          {error && <p className="mt-3 text-[11px] text-accent-red">{error}</p>}
          {success && <p className="mt-3 text-[11px] text-accent-green">{success}</p>}

          <div className="flex items-center justify-end gap-2 mt-5 flex-wrap">
            <button
              onClick={onClose}
              disabled={busy}
              className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              onClick={handleInvite}
              disabled={busy || !email.trim()}
              className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] shrink-0 whitespace-nowrap"
            >
              {busy ? "Inviting..." : "Send invite"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
