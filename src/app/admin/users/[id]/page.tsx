"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import ArrowLeft02Icon from "@hugeicons/core-free-icons/ArrowLeft02Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import StopCircleIcon from "@hugeicons/core-free-icons/StopCircleIcon";
import PlayCircleIcon from "@hugeicons/core-free-icons/PlayCircleIcon";
import CloudServerIcon from "@hugeicons/core-free-icons/CloudServerIcon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";

type Role = "user" | "admin" | "owner";
type Me = { userId: string; role: Role };

type Detail = {
  user: {
    id: string;
    email: string;
    role: Role;
    createdAt: string;
    lastLoginAt: string | null;
    suspendedAt: string | null;
    suspendedReason: string | null;
  };
  usage: {
    totalBytes: number;
    fileCount: number;
    trashedBytes: number;
    trashedCount: number;
  };
  sessions: Array<{ jti: string; expiresAt: string }>;
  audit: Array<{
    id: number;
    occurred_at: string;
    event_type: string;
    actor_user_id: string | null;
    target_user_id: string | null;
    target_file_id: string | null;
    detail: string | null;
  }>;
  notes: Array<{
    id: number;
    created_at: string;
    author_user_id: string | null;
    author_email: string | null;
    body: string;
  }>;
};

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return iso.slice(0, 10);
}

function formatFullDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function colorForEmail(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) & 0xffffffff;
  const palette = [
    "var(--accent-blue-primary)",
    "var(--accent-green-primary)",
    "var(--accent-pink-primary)",
    "var(--accent-yellow-primary)",
    "var(--accent-orange-primary)",
    "var(--accent-dark-blue-primary)",
  ];
  return palette[Math.abs(hash) % palette.length];
}

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const userId = params.id;

  const [detail, setDetail] = useState<Detail | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [confirm, setConfirm] = useState<null | { kind: "suspend" | "delete" | "role"; to?: Role }>(
    null
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("User not found");
          return;
        }
        throw new Error(`${res.status}`);
      }
      const data = await res.json();
      setDetail(data);
    } catch {
      setError("Failed to load user");
    }
  }, [userId]);

  useEffect(() => {
    fetch("/api/admin/me").then((r) => r.json()).then(setMe).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<Response>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const suspend = (reason: string) =>
    act(() =>
      fetch(`/api/admin/users/${userId}/suspend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      })
    );

  const unsuspend = () =>
    act(() => fetch(`/api/admin/users/${userId}/unsuspend`, { method: "POST" }));

  const changeRole = (role: Role) =>
    act(() =>
      fetch(`/api/admin/users/${userId}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      })
    );

  const deleteUser = (confirmEmail: string, reason: string) =>
    act(async () => {
      const res = await fetch(`/api/admin/users/${userId}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail, reason }),
      });
      if (res.ok) router.replace("/admin/users");
      return res;
    });

  const revokeSession = (jti: string) =>
    act(() =>
      fetch(`/api/admin/users/${userId}/sessions/${encodeURIComponent(jti)}`, {
        method: "DELETE",
      })
    );

  const addNote = async () => {
    const body = noteDraft.trim();
    if (!body) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setNoteDraft("");
      await load();
    } catch {
      setError("Failed to save note");
    } finally {
      setBusy(false);
    }
  };

  const deleteNote = (noteId: number) =>
    act(() =>
      fetch(`/api/admin/users/${userId}/notes/${noteId}`, { method: "DELETE" })
    );

  const canActOnUser = (): boolean => {
    if (!me || !detail) return false;
    if (detail.user.id === me.userId) return false;
    if (detail.user.role === "owner") return false;
    if (detail.user.role === "admin" && me.role !== "owner") return false;
    return true;
  };

  return (
    <>
      {/* Header bar */}
      <div className="relative flex items-center justify-between px-5 h-[52px] shrink-0 border-b border-border-secondary gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/admin/users"
            className="p-1.5 rounded-md text-icon-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} size={16} />
          </Link>
          <span className="text-[13px] text-text-primary font-medium truncate">
            {detail?.user.email ?? "Loading…"}
          </span>
          {detail?.user.suspendedAt && (
            <span className="px-2 py-0.5 rounded-[4px] text-[10px] font-mono uppercase tracking-wider bg-bg-field text-accent-red shrink-0">
              suspended
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-3 px-4 py-3 rounded-[8px] bg-accent-yellow-bg text-[13px] text-text-primary">
          {error}
        </div>
      )}

      {!detail && !error && (
        <div className="flex-1 flex items-center justify-center text-[13px] text-text-tertiary">
          Loading…
        </div>
      )}

      {detail && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[1100px] mx-auto px-6 md:px-8 py-8 space-y-6">
            {/* Profile card + action rail */}
            <section className="rounded-[12px] border border-border-secondary bg-bg-l2 p-5">
              <div className="flex items-start gap-4">
                <div
                  className="w-12 h-12 rounded-[10px] flex items-center justify-center text-[18px] font-bold text-white shrink-0"
                  style={{ backgroundColor: colorForEmail(detail.user.email) }}
                >
                  {detail.user.email[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h1 className="text-[18px] font-semibold text-text-primary truncate">
                      {detail.user.email}
                    </h1>
                    <span
                      className={`px-2 py-0.5 rounded-[6px] text-[10px] font-mono uppercase tracking-wider ${
                        detail.user.role === "owner"
                          ? "bg-accent-green-bg text-accent-green"
                          : detail.user.role === "admin"
                          ? "bg-accent-yellow-bg text-accent-yellow"
                          : "bg-bg-field text-text-tertiary"
                      }`}
                    >
                      {detail.user.role}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-text-tertiary">
                    <span>Joined {formatFullDate(detail.user.createdAt)}</span>
                    <span>·</span>
                    <span>Last login {formatRelative(detail.user.lastLoginAt)}</span>
                    {detail.user.suspendedAt && (
                      <>
                        <span>·</span>
                        <span className="text-accent-red">
                          Suspended {formatRelative(detail.user.suspendedAt)}
                          {detail.user.suspendedReason ? ` — ${detail.user.suspendedReason}` : ""}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {canActOnUser() && (
                  <div className="flex items-center gap-2 shrink-0">
                    {detail.user.suspendedAt ? (
                      <button
                        onClick={unsuspend}
                        disabled={busy}
                        className="flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <HugeiconsIcon icon={PlayCircleIcon} size={14} />
                        Unsuspend
                      </button>
                    ) : (
                      <button
                        onClick={() => setConfirm({ kind: "suspend" })}
                        disabled={busy}
                        className="flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <HugeiconsIcon icon={StopCircleIcon} size={14} />
                        Suspend
                      </button>
                    )}
                    {me?.role === "owner" && (
                      <>
                        <select
                          value={detail.user.role}
                          onChange={(e) => {
                            const next = e.target.value as Role;
                            if (next !== detail.user.role)
                              setConfirm({ kind: "role", to: next });
                          }}
                          disabled={busy}
                          className="h-[30px] px-2 rounded-[8px] text-[12px] font-medium text-text-secondary bg-bg-field border border-border-secondary cursor-pointer disabled:opacity-50"
                        >
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                          <option value="owner">owner</option>
                        </select>
                        <button
                          onClick={() => setConfirm({ kind: "delete" })}
                          disabled={busy}
                          className="flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] text-[12px] font-medium text-accent-red hover:bg-accent-red/10 border border-accent-red/30 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <HugeiconsIcon icon={Delete02Icon} size={14} />
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Usage + Sessions row */}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Usage */}
              <div className="rounded-[12px] border border-border-secondary bg-bg-l2 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <HugeiconsIcon icon={CloudServerIcon} size={14} className="text-text-tertiary" />
                  <h2 className="text-[13px] font-semibold text-text-primary">Storage</h2>
                </div>
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <div className="text-[22px] font-semibold text-text-primary tabular-nums leading-none">
                      {formatBytes(detail.usage.totalBytes)}
                    </div>
                    <div className="text-[11px] font-mono uppercase tracking-wider text-text-disabled mt-2">
                      Active
                    </div>
                  </div>
                  <div>
                    <div className="text-[22px] font-semibold text-text-primary tabular-nums leading-none">
                      {detail.usage.fileCount.toLocaleString()}
                    </div>
                    <div className="text-[11px] font-mono uppercase tracking-wider text-text-disabled mt-2">
                      Files
                    </div>
                  </div>
                </div>
                {(detail.usage.trashedBytes > 0 || detail.usage.trashedCount > 0) && (
                  <div className="mt-4 pt-4 border-t border-border-tertiary flex items-center justify-between text-[12px] text-text-tertiary">
                    <span>
                      In trash: {detail.usage.trashedCount.toLocaleString()} file
                      {detail.usage.trashedCount === 1 ? "" : "s"}
                    </span>
                    <span className="tabular-nums">{formatBytes(detail.usage.trashedBytes)}</span>
                  </div>
                )}
              </div>

              {/* Sessions */}
              <div className="rounded-[12px] border border-border-secondary bg-bg-l2 overflow-hidden flex flex-col">
                <div className="flex items-center gap-2 px-5 h-[44px] border-b border-border-secondary">
                  <HugeiconsIcon icon={ComputerIcon} size={14} className="text-text-tertiary" />
                  <h2 className="text-[13px] font-semibold text-text-primary">
                    Active sessions ({detail.sessions.length})
                  </h2>
                </div>
                {detail.sessions.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center py-8 text-[12px] text-text-tertiary">
                    No active sessions.
                  </div>
                ) : (
                  <ul>
                    {detail.sessions.map((s) => (
                      <li
                        key={s.jti}
                        className="flex items-center justify-between px-5 h-[44px] border-b border-border-tertiary last:border-b-0"
                      >
                        <div className="min-w-0">
                          <div className="text-[12px] font-mono text-text-primary truncate">
                            {s.jti.slice(0, 8)}…
                          </div>
                          <div className="text-[11px] text-text-tertiary">
                            Expires {formatRelative(s.expiresAt)}
                          </div>
                        </div>
                        <button
                          onClick={() => revokeSession(s.jti)}
                          disabled={busy}
                          className="flex items-center gap-1 h-[26px] px-2.5 rounded-[6px] text-[11px] font-medium text-text-tertiary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {/* Notes */}
            <section className="rounded-[12px] border border-border-secondary bg-bg-l2 overflow-hidden">
              <div className="px-5 h-[44px] flex items-center border-b border-border-secondary">
                <h2 className="text-[13px] font-semibold text-text-primary">
                  Admin notes ({detail.notes.length})
                </h2>
              </div>
              <div className="p-4">
                <div className="flex gap-2">
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Add a note — visible to admins only."
                    rows={2}
                    maxLength={2000}
                    className="flex-1 px-3 py-2 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none resize-none"
                  />
                  <button
                    onClick={addNote}
                    disabled={busy || !noteDraft.trim()}
                    className="h-[36px] px-4 rounded-[8px] text-[13px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-all cursor-pointer disabled:opacity-50 self-start"
                  >
                    Add
                  </button>
                </div>
              </div>
              {detail.notes.length > 0 && (
                <ul className="border-t border-border-tertiary">
                  {detail.notes.map((n) => {
                    const canDelete = me?.userId === n.author_user_id || me?.role === "owner";
                    return (
                      <li key={n.id} className="group relative px-5 py-3 border-b border-border-tertiary last:border-b-0 flex gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] text-text-primary whitespace-pre-wrap break-words">{n.body}</div>
                          <div className="text-[11px] text-text-tertiary mt-1">
                            {n.author_email ?? "unknown"} · {formatRelative(n.created_at)}
                          </div>
                        </div>
                        {canDelete && (
                          <button
                            onClick={() => deleteNote(n.id)}
                            disabled={busy}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-icon-tertiary hover:text-accent-red hover:bg-cta-nav-hover transition-all cursor-pointer disabled:opacity-50 self-start"
                          >
                            <HugeiconsIcon icon={Cancel01Icon} size={12} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Audit */}
            <section className="rounded-[12px] border border-border-secondary bg-bg-l2 overflow-hidden">
              <div className="px-5 h-[44px] flex items-center border-b border-border-secondary">
                <h2 className="text-[13px] font-semibold text-text-primary">
                  Recent activity ({detail.audit.length})
                </h2>
              </div>
              {detail.audit.length === 0 ? (
                <div className="py-8 text-center text-[12px] text-text-tertiary">No events.</div>
              ) : (
                <ul>
                  {detail.audit.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-start gap-4 px-5 py-3 border-b border-border-tertiary last:border-b-0"
                    >
                      <div className="w-[110px] text-[11px] text-text-tertiary tabular-nums shrink-0 pt-0.5">
                        {formatRelative(e.occurred_at)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[12px] text-text-primary">{e.event_type}</div>
                        {e.detail && (
                          <div className="text-[11px] text-text-tertiary mt-0.5 truncate" title={e.detail}>
                            {e.detail}
                          </div>
                        )}
                        {e.target_file_id && (
                          <div className="flex items-center gap-1 text-[11px] text-text-disabled mt-0.5">
                            <HugeiconsIcon icon={File01Icon} size={10} />
                            <span className="font-mono">{e.target_file_id.slice(0, 8)}…</span>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      {/* Modals */}
      {confirm?.kind === "suspend" && detail && (
        <SuspendModal
          email={detail.user.email}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={suspend}
        />
      )}
      {confirm?.kind === "delete" && detail && (
        <DeleteModal
          email={detail.user.email}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={deleteUser}
        />
      )}
      {confirm?.kind === "role" && confirm.to && detail && (
        <RoleModal
          email={detail.user.email}
          from={detail.user.role}
          to={confirm.to}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => changeRole(confirm.to!)}
        />
      )}
    </>
  );
}

function SuspendModal({
  email,
  busy,
  onCancel,
  onConfirm,
}: {
  email: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal onCancel={onCancel} title={`Suspend ${email}?`}>
      <p className="text-[13px] text-text-secondary leading-relaxed mb-4">
        Revokes all their sessions and blocks future logins until unsuspended. Their data is preserved.
      </p>
      <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1.5">
        Reason (optional, internal only)
      </label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        placeholder="e.g. ToS violation — spam"
        className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
        autoFocus
      />
      <ModalFooter
        busy={busy}
        onCancel={onCancel}
        onConfirm={() => onConfirm(reason)}
        confirmLabel="Suspend"
      />
    </Modal>
  );
}

function DeleteModal({
  email,
  busy,
  onCancel,
  onConfirm,
}: {
  email: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (confirmEmail: string, reason: string) => void;
}) {
  const [confirmEmail, setConfirmEmail] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Modal onCancel={onCancel} title={`Delete ${email}?`}>
      <p className="text-[13px] text-text-secondary leading-relaxed mb-4">
        Permanently deletes their account, all files, and all encrypted blobs from R2. Cannot be undone.
      </p>
      <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1.5">
        Type the email to confirm
      </label>
      <input
        type="text"
        value={confirmEmail}
        onChange={(e) => setConfirmEmail(e.target.value)}
        placeholder={email}
        className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none mb-3"
        autoFocus
      />
      <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1.5">
        Reason (internal)
      </label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
      />
      <ModalFooter
        busy={busy}
        disabled={confirmEmail !== email}
        onCancel={onCancel}
        onConfirm={() => onConfirm(confirmEmail, reason)}
        confirmLabel="Delete permanently"
        danger
      />
    </Modal>
  );
}

function RoleModal({
  email,
  from,
  to,
  busy,
  onCancel,
  onConfirm,
}: {
  email: string;
  from: Role;
  to: Role;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal onCancel={onCancel} title={`Change role: ${email}`}>
      <p className="text-[13px] text-text-secondary leading-relaxed mb-4">
        {from} → {to}.{" "}
        {to === "admin"
          ? "Grants access to the admin panel. They can suspend users and view audit logs."
          : to === "owner"
          ? "Grants full admin powers including role changes and user deletion."
          : "Removes admin access."}
      </p>
      <ModalFooter busy={busy} onCancel={onCancel} onConfirm={onConfirm} confirmLabel="Confirm" />
    </Modal>
  );
}

function Modal({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] rounded-[14px] border border-border-primary bg-bg-l2 p-5"
      >
        <h2 className="text-[16px] font-semibold text-text-primary mb-1.5">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({
  busy,
  disabled,
  danger,
  onCancel,
  onConfirm,
  confirmLabel,
}: {
  busy: boolean;
  disabled?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2 mt-4">
      <button
        onClick={onCancel}
        disabled={busy}
        className="h-[34px] px-4 rounded-[8px] text-[13px] text-text-secondary hover:bg-cta-secondary-hover transition-colors cursor-pointer disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={busy || disabled}
        className={`h-[34px] px-4 rounded-[8px] text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50 ${
          danger ? "text-white bg-accent-red hover:opacity-90" : "text-text-inverse bg-cta-primary hover:opacity-90"
        }`}
      >
        {confirmLabel}
      </button>
    </div>
  );
}
