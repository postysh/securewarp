"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import Link04Icon from "@hugeicons/core-free-icons/Link04Icon";
import Copy01Icon from "@hugeicons/core-free-icons/Copy01Icon";
import { useFilesContext, type DecryptedFile, type Collaborator, type PermissionLevel } from "@/hooks/use-files";
import { initialsFromEmail, colorForEmail } from "@/lib/avatar";
import { userLabel, userInitials, userColor } from "@/lib/display";
import { RoleDropdown } from "./role-dropdown";
import { ConfirmDialog } from "./confirm-dialog";

const ROLE_OPTIONS = ["editor", "viewer"] as const satisfies readonly PermissionLevel[];
const ROLE_LABELS: Record<PermissionLevel, string> = {
  editor: "Editor",
  viewer: "Viewer",
};

const EXPIRY_OPTIONS = ["never", "1h", "1d", "7d", "30d"] as const;
const EXPIRY_LABELS: Record<string, string> = {
  never: "No expiry",
  "1h": "1 hour",
  "1d": "1 day",
  "7d": "7 days",
  "30d": "30 days",
};

interface ShareModalProps {
  file: DecryptedFile | null;
  onClose: () => void;
}

interface LinkSummary {
  id: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  permissionLevel: string;
}

export function ShareModal({ file, onClose }: ShareModalProps) {
  const fileOps = useFilesContext();
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loadingCollabs, setLoadingCollabs] = useState(false);
  const [links, setLinks] = useState<LinkSummary[]>([]);
  const [creatingLink, setCreatingLink] = useState(false);
  // The freshly created URL is only shown once — after the modal is
  // closed or another link is created, it disappears forever. Matches the
  // Skiff UX: links cannot be recovered server-side.
  const [freshLinkUrl, setFreshLinkUrl] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkPassword, setLinkPassword] = useState("");
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [linkExpiry, setLinkExpiry] = useState<string>("never");
  // userId currently being rotated out (for inline spinner state). null
  // when no rotation is in flight.
  const [rotatingUserId, setRotatingUserId] = useState<string | null>(null);
  // Themed confirmation dialog state. Holds the collaborator pending
  // revoke until the user confirms or cancels.
  const [revokeTarget, setRevokeTarget] = useState<Collaborator | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = file !== null;

  useEffect(() => {
    if (!open || !file) return;
    setInputValue("");
    setInputError("");
    setInfo("");
    setFreshLinkUrl(null);
    setLinkCopied(false);
    setLinkPassword("");
    setShowPasswordField(false);
    setLinkExpiry("never");
    setLoadingCollabs(true);
    fileOps
      .loadCollaborators(file.id)
      .then((list) => setCollaborators(list))
      .finally(() => setLoadingCollabs(false));
    fileOps.listLinks(file.id).then((list) => setLinks(list));
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

  /**
   * Phase 5 — rotate the file's keys and drop the revoked user in a
   * single forward-secret operation. Unlike `removeCollab`, any
   * ciphertext the revoked user cached before this completes is no
   * longer decryptable against the current state of the file.
   * Scoped to non-folder files — the share modal greys the action
   * out for folders with a tooltip explaining why.
   */
  /**
   * Opens the themed ConfirmDialog for destructive revocation. The
   * actual rotation runs once the user confirms — see `executeRotate`.
   */
  const rotateOutCollab = (c: Collaborator) => {
    if (c.isOwner || !file) return;
    setInputError("");
    setRevokeTarget(c);
  };

  const executeRotate = async () => {
    if (!file || !revokeTarget) return;
    const c = revokeTarget;
    setRotatingUserId(c.userId);
    setInputError("");
    const result = file.isFolder
      ? await fileOps.rotateAndRevokeFolder(file, c.userId)
      : await fileOps.rotateAndRevoke(file, c.userId);
    setRotatingUserId(null);
    if (!result.ok) {
      setInputError(result.error);
      setRevokeTarget(null);
      return;
    }
    setCollaborators((prev) => prev.filter((x) => x.userId !== c.userId));
    setInfo(`Securely revoked ${c.email}`);
    setRevokeTarget(null);
  };

  const handleCreateLink = async () => {
    if (!file || creatingLink) return;
    setCreatingLink(true);
    setLinkCopied(false);
    // Argon2id runs on the main thread — it takes ~200-400ms on a
    // modern laptop with the Phase 4.1 parameters (32 MB / 2 iters).
    // Worth flagging to the user via the "Creating…" spinner already
    // on the button.
    const password = showPasswordField && linkPassword.length > 0 ? linkPassword : undefined;
    let expiresAt: string | undefined;
    if (linkExpiry !== "never") {
      const d = new Date();
      if (linkExpiry === "1h") d.setHours(d.getHours() + 1);
      else if (linkExpiry === "1d") d.setDate(d.getDate() + 1);
      else if (linkExpiry === "7d") d.setDate(d.getDate() + 7);
      else if (linkExpiry === "30d") d.setDate(d.getDate() + 30);
      expiresAt = d.toISOString();
    }
    const result = await fileOps.createLink(file, { password, expiresAt });
    setCreatingLink(false);
    if (!result.ok) {
      setInputError(result.error);
      return;
    }
    setFreshLinkUrl(result.url);
    setLinkPassword("");
    setShowPasswordField(false);
    try {
      await navigator.clipboard.writeText(result.url);
      setLinkCopied(true);
    } catch {
      // clipboard permission denied — user can copy manually from the
      // visible box.
    }
    fileOps.listLinks(file.id).then((list) => setLinks(list));
  };

  const handleRevokeLink = async (linkId: string) => {
    if (!file) return;
    const result = await fileOps.revokeLink(linkId);
    if (!result.ok) {
      setInputError(result.error);
      return;
    }
    setLinks((prev) => prev.filter((l) => l.id !== linkId));
    setInfo("Link revoked");
  };

  const copyFresh = async () => {
    if (!freshLinkUrl) return;
    try {
      await navigator.clipboard.writeText(freshLinkUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      // no-op
    }
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
        role="dialog" aria-modal="true" aria-label="Share" className="relative w-full h-full md:h-auto max-w-none md:max-w-[480px] md:max-h-[85vh] mx-0 md:mx-4 rounded-none md:rounded-2xl bg-bg-l3 border-0 md:border border-border-primary overflow-hidden animate-fade-in"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        {/* Cream header band — eyebrow + icon tile + filename. Close
            button sits in the top-right corner so it survives the band. */}
        <div className="relative bg-bg-side px-6 py-5 border-b border-border-tertiary">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer"
            aria-label="Close"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
          </button>
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-disabled mb-3">
            {file.isFolder ? "Share folder" : "Share file"}
          </div>
          <div className="flex items-center gap-3 min-w-0 pr-8">
            <div className="w-10 h-10 rounded-[10px] bg-bg-l3 border border-border-tertiary flex items-center justify-center shrink-0">
              <HugeiconsIcon icon={UserAdd01Icon} size={18} color="var(--text-link)" />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-text-primary truncate">
                {file.name}
              </div>
              <div className="text-[11px] text-text-disabled">
                Encrypted end to end in your browser
              </div>
            </div>
          </div>
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
                className="w-full px-3.5 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-text-link/25 transition-all border border-transparent focus:border-text-link/40 disabled:opacity-60"
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
                    style={{ backgroundColor: userColor(c) }}
                  >
                    {userInitials(c)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-text-primary truncate">{userLabel(c)}</p>
                    <p className="text-[10px] text-text-disabled truncate">
                      {c.displayName?.trim() && c.email ? c.email + " · " : ""}
                      {c.isOwner ? "Owner" : c.permissionLevel === "viewer" ? "Can view" : "Can edit"}
                    </p>
                  </div>
                  {c.isOwner ? (
                    <span className="text-[11px] text-text-disabled px-2">Owner</span>
                  ) : (
                    <div className="flex items-center gap-1">
                      <RoleDropdown<PermissionLevel>
                        value={c.permissionLevel === "owner" ? "editor" : c.permissionLevel}
                        options={ROLE_OPTIONS}
                        labels={ROLE_LABELS}
                        onChange={(v) => changePermission(c, v)}
                        onRemove={() => removeCollab(c)}
                      />
                      <button
                        onClick={() => rotateOutCollab(c)}
                        disabled={rotatingUserId !== null}
                        title={
                          file.isFolder
                            ? "Revoke & rotate folder keys (shallow, see confirm dialog)"
                            : "Revoke & rotate file keys (forward-secret)"
                        }
                        className="text-[10px] text-accent-red hover:underline px-1.5 h-[26px] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {rotatingUserId === c.userId ? "Rotating…" : "Revoke"}
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Link access */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <HugeiconsIcon icon={Link04Icon} size={14} color="var(--icon-tertiary)" />
                <span className="text-[12px] font-medium text-text-primary">Public link</span>
              </div>
              <div className="flex items-center gap-2">
                <RoleDropdown
                  value={linkExpiry}
                  options={EXPIRY_OPTIONS}
                  labels={EXPIRY_LABELS}
                  onChange={(v) => setLinkExpiry(v)}
                />
                <button
                  onClick={() => setShowPasswordField((v) => !v)}
                  className="text-[11px] text-text-tertiary hover:text-text-primary cursor-pointer"
                >
                  {showPasswordField ? "No password" : "Password"}
                </button>
                <button
                  onClick={handleCreateLink}
                  disabled={creatingLink || (showPasswordField && linkPassword.length === 0)}
                  className="text-[11px] text-accent-green hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creatingLink ? "Creating…" : "Create link"}
                </button>
              </div>
            </div>

            {showPasswordField && (
              <div className="mb-2">
                <input
                  type="password"
                  value={linkPassword}
                  onChange={(e) => setLinkPassword(e.target.value)}
                  placeholder="Set a password"
                  className="w-full px-3 py-2 rounded-[10px] bg-bg-field text-[12px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-text-link/25 transition-all border border-transparent focus:border-text-link/40"
                />
                <p className="mt-1 text-[10px] text-text-disabled">
                  Visitors must enter this password. Store it separately. We
                  can&apos;t recover it if lost.
                </p>
              </div>
            )}

            {freshLinkUrl && (
              <div className="mb-2 p-2.5 rounded-[10px] bg-bg-field border border-border-tertiary">
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={freshLinkUrl}
                    className="flex-1 bg-transparent text-[11px] text-text-primary font-mono truncate focus:outline-none"
                  />
                  <button
                    onClick={copyFresh}
                    className="shrink-0 flex items-center gap-1 px-2 h-[24px] rounded-[6px] text-[11px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
                  >
                    <HugeiconsIcon icon={Copy01Icon} size={12} />
                    {linkCopied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-text-disabled">
                  This URL cannot be retrieved later. Copy it now or create a new link.
                </p>
              </div>
            )}

            {links.length > 0 && (
              <div className="rounded-[10px] border border-border-tertiary overflow-hidden">
                {links.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center gap-2 px-3 py-2 border-b border-border-tertiary last:border-b-0"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-text-primary font-mono truncate">
                        /share/{l.id.slice(0, 8)}…
                      </div>
                      <div className="text-[10px] text-text-disabled">
                        {l.expiresAt
                          ? `Expires ${new Date(l.expiresAt).toLocaleDateString()}`
                          : "No expiration"}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRevokeLink(l.id)}
                      className="text-[11px] text-accent-red hover:bg-bg-cell-hover rounded-[6px] px-2 h-[24px] transition-colors cursor-pointer"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}

            {links.length === 0 && !freshLinkUrl && (
              <p className="text-[11px] text-text-disabled">
                No active public links.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 mt-5">
            <button
              onClick={onClose}
              className="h-[36px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      {revokeTarget && (
        <ConfirmDialog
          open={revokeTarget !== null}
          destructive
          title={file.isFolder ? "Revoke folder access" : "Revoke file access"}
          description={
            file.isFolder ? (
              <>
                Securely revoke <b>{revokeTarget.email}</b> from this folder?
                {"\n\n"}
                This rotates the folder&apos;s keys and re-wraps access to every direct
                child. Existing file contents inside the folder are <b>not</b>{" "}
                re-encrypted. If {revokeTarget.email} had already opened and cached a
                specific file before revocation, they may still be able to read that
                exact cached copy. New files added after this point, and any files
                they hadn&apos;t opened, will be fully protected.
              </>
            ) : (
              <>
                Securely revoke <b>{revokeTarget.email}</b>?
                {"\n\n"}
                This re-encrypts the file and re-wraps keys for everyone else.
                Large files may take a while.
              </>
            )
          }
          confirmLabel="Revoke & rotate"
          busy={rotatingUserId === revokeTarget.userId}
          busyLabel="Rotating…"
          onConfirm={executeRotate}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </div>,
    document.body
  );
}
