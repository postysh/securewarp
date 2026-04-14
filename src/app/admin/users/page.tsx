"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";

type Role = "user" | "admin" | "owner";

type UserRow = {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  lastLoginAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  storageBytes: number;
  fileCount: number;
};

type Me = { userId: string; role: Role };

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return "today";
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return d.toISOString().slice(0, 10);
}

// Deterministic color-for-email: same email always maps to the same hue.
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

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<number | null>(0);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: "suspend"; user: UserRow }
    | { kind: "delete"; user: UserRow }
    | { kind: "role"; user: UserRow; to: Role }
    | null
  >(null);

  const load = useCallback(async (offset: number, searchTerm: string, replace: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (offset) params.set("cursor", String(offset));
      if (searchTerm) params.set("search", searchTerm);
      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setUsers((prev) => (replace ? data.users : [...prev, ...data.users]));
      setTotal(data.total);
      setNextCursor(data.nextCursor);
    } catch {
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/admin/me").then((r) => r.json()).then(setMe).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setCursor(0);
      load(0, search, true);
    }, 300);
    return () => clearTimeout(t);
  }, [search, load]);

  const performAction = async (fn: () => Promise<Response>) => {
    setActioning(menuOpen);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${res.status}`);
      }
      await load(cursor ?? 0, search, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActioning(null);
      setMenuOpen(null);
      setConfirm(null);
    }
  };

  const suspend = (user: UserRow, reason: string) =>
    performAction(() =>
      fetch(`/api/admin/users/${user.id}/suspend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      })
    );

  const unsuspend = (user: UserRow) =>
    performAction(() => fetch(`/api/admin/users/${user.id}/unsuspend`, { method: "POST" }));

  const changeRole = (user: UserRow, role: Role) =>
    performAction(() =>
      fetch(`/api/admin/users/${user.id}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      })
    );

  const deleteUser = (user: UserRow, confirmEmail: string, reason: string) =>
    performAction(() =>
      fetch(`/api/admin/users/${user.id}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail, reason }),
      })
    );

  const canActOn = (user: UserRow): boolean => {
    if (!me) return false;
    if (user.id === me.userId) return false;
    if (user.role === "owner") return false;
    if (user.role === "admin" && me.role !== "owner") return false;
    return true;
  };

  return (
    <>
      {/* Header bar */}
      <div className="relative flex items-center justify-between px-5 h-[52px] shrink-0 border-b border-border-secondary gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[13px] text-text-primary font-medium">Users</span>
          <span className="text-[12px] text-text-tertiary">{total.toLocaleString()} total</span>
        </div>
        <div className="relative shrink-0">
          <HugeiconsIcon
            icon={Search01Icon}
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
          />
          <input
            type="search"
            placeholder="Search by email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-[32px] w-[260px] pl-8 pr-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-3 px-4 py-3 rounded-[8px] bg-accent-yellow-bg text-[13px] text-text-primary">
          {error}
        </div>
      )}

      {/* Column header row — matches file-browser list layout */}
      {users.length > 0 && (
        <div className="hidden md:flex items-center h-[40px] px-4 mx-3 md:mx-5 box-border select-none shrink-0 border-b border-border-tertiary">
          <div className="flex items-center flex-1 min-w-0 pr-4">
            <span className="text-[11px] font-mono uppercase text-text-disabled">Email</span>
          </div>
          <div className="flex items-center gap-[46px]">
            <div className="w-[80px] flex justify-end">
              <span className="text-[11px] font-mono uppercase text-text-disabled">Role</span>
            </div>
            <div className="w-[100px] flex justify-end">
              <span className="text-[11px] font-mono uppercase text-text-disabled">Storage</span>
            </div>
            <div className="w-[70px] flex justify-end">
              <span className="text-[11px] font-mono uppercase text-text-disabled">Files</span>
            </div>
            <div className="w-[100px] hidden md:flex justify-end">
              <span className="text-[11px] font-mono uppercase text-text-disabled">Last login</span>
            </div>
            <div className="w-[90px] hidden lg:flex justify-end">
              <span className="text-[11px] font-mono uppercase text-text-disabled">Joined</span>
            </div>
          </div>
          <div className="w-[44px] shrink-0" />
        </div>
      )}

      {/* Scrollable row list */}
      <div className="flex-1 overflow-y-auto px-3 md:px-5 pt-1 pb-4">
        {users.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-24">
            <h3 className="text-[15px] font-medium text-text-primary mb-1">No users match</h3>
            <p className="text-[12px] text-text-tertiary">Try a different search term.</p>
          </div>
        )}

        {users.map((u) => {
          const actionable = canActOn(u);
          return (
            <div
              key={u.id}
              className={`group relative flex items-center h-[52px] px-4 rounded-[8px] transition-colors ${
                u.suspendedAt ? "opacity-70" : ""
              } hover:bg-bg-cell-hover`}
            >
              {/* Avatar + email */}
              <div className="flex items-center flex-1 min-w-0 pr-4 gap-3">
                <div
                  className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                  style={{ backgroundColor: colorForEmail(u.email) }}
                >
                  {u.email[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] text-text-primary truncate">{u.email}</span>
                    {u.suspendedAt && (
                      <span
                        title={u.suspendedReason ?? "Suspended"}
                        className="px-1.5 py-0.5 rounded-[4px] text-[9px] font-mono uppercase tracking-wider bg-bg-field text-accent-red shrink-0"
                      >
                        suspended
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Metadata columns */}
              <div className="hidden md:flex items-center gap-[46px] relative">
                <div className="w-[80px] flex justify-end">
                  {u.role !== "user" ? (
                    <span
                      className={`flex h-5 items-center justify-center rounded bg-bg-field px-1.5 py-0.5 text-[11px] font-mono uppercase ${
                        u.role === "owner" ? "text-accent-green" : "text-accent-yellow"
                      }`}
                    >
                      {u.role}
                    </span>
                  ) : (
                    <span className="text-[11px] font-mono uppercase text-text-disabled">user</span>
                  )}
                </div>
                <div className="w-[100px] flex justify-end">
                  <span className="text-[12px] text-text-disabled tabular-nums">
                    {formatBytes(u.storageBytes)}
                  </span>
                </div>
                <div className="w-[70px] flex justify-end">
                  <span className="text-[12px] text-text-disabled tabular-nums">
                    {u.fileCount.toLocaleString()}
                  </span>
                </div>
                <div
                  className={`w-[100px] hidden md:flex justify-end transition-opacity ${
                    menuOpen === u.id ? "opacity-0" : actionable ? "group-hover:opacity-0" : ""
                  }`}
                >
                  <span className="text-[12px] text-text-disabled">{formatDate(u.lastLoginAt)}</span>
                </div>
                <div
                  className={`w-[90px] hidden lg:flex justify-end transition-opacity ${
                    menuOpen === u.id ? "opacity-0" : actionable ? "group-hover:opacity-0" : ""
                  }`}
                >
                  <span className="text-[12px] text-text-disabled">{formatDate(u.createdAt)}</span>
                </div>

                {/* Hover actions */}
                {actionable && (
                  <div
                    className={`absolute right-0 flex items-center transition-opacity ${
                      menuOpen === u.id
                        ? "opacity-100 pointer-events-auto"
                        : "opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                    }`}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen((o) => (o === u.id ? null : u.id));
                      }}
                      disabled={actioning === u.id}
                      className="p-1.5 rounded-md text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer"
                    >
                      <HugeiconsIcon icon={MoreHorizontalIcon} size={15} />
                    </button>

                    {menuOpen === u.id && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(null)} />
                        <div
                          className="absolute right-0 top-full mt-1 w-[180px] rounded-[10px] border border-border-primary bg-bg-l3 z-50 py-1"
                          style={{ boxShadow: "var(--shadow-l2)" }}
                        >
                          {u.suspendedAt ? (
                            <button
                              onClick={() => unsuspend(u)}
                              className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-cta-nav-hover cursor-pointer"
                            >
                              Unsuspend
                            </button>
                          ) : (
                            <button
                              onClick={() => setConfirm({ kind: "suspend", user: u })}
                              className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-cta-nav-hover cursor-pointer"
                            >
                              Suspend…
                            </button>
                          )}
                          {me?.role === "owner" && (
                            <>
                              <div className="h-px bg-border-secondary my-1" />
                              {u.role !== "admin" && (
                                <button
                                  onClick={() => setConfirm({ kind: "role", user: u, to: "admin" })}
                                  className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-cta-nav-hover cursor-pointer"
                                >
                                  Promote to admin
                                </button>
                              )}
                              {u.role !== "user" && (
                                <button
                                  onClick={() => setConfirm({ kind: "role", user: u, to: "user" })}
                                  className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-cta-nav-hover cursor-pointer"
                                >
                                  Demote to user
                                </button>
                              )}
                              <div className="h-px bg-border-secondary my-1" />
                              <button
                                onClick={() => setConfirm({ kind: "delete", user: u })}
                                className="w-full text-left px-3 py-2 text-[13px] text-accent-red hover:bg-cta-nav-hover cursor-pointer"
                              >
                                Delete account…
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading && users.length === 0 && (
          <div className="py-8 text-center text-[12px] text-text-tertiary">Loading…</div>
        )}

        {nextCursor != null && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => {
                setCursor(nextCursor);
                load(nextCursor, search, false);
              }}
              disabled={loading}
              className="h-[32px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50"
            >
              Load more
            </button>
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          confirm={confirm}
          onCancel={() => setConfirm(null)}
          onSuspend={(reason) => suspend(confirm.user, reason)}
          onRole={() => confirm.kind === "role" && changeRole(confirm.user, confirm.to)}
          onDelete={(email, reason) => deleteUser(confirm.user, email, reason)}
          busy={actioning !== null}
        />
      )}
    </>
  );
}

function ConfirmModal({
  confirm,
  onCancel,
  onSuspend,
  onRole,
  onDelete,
  busy,
}: {
  confirm:
    | { kind: "suspend"; user: UserRow }
    | { kind: "delete"; user: UserRow }
    | { kind: "role"; user: UserRow; to: Role };
  onCancel: () => void;
  onSuspend: (reason: string) => void;
  onRole: () => void;
  onDelete: (email: string, reason: string) => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");

  const title = useMemo(() => {
    if (confirm.kind === "suspend") return `Suspend ${confirm.user.email}?`;
    if (confirm.kind === "delete") return `Delete ${confirm.user.email}?`;
    return `Change role: ${confirm.user.email} → ${confirm.to}?`;
  }, [confirm]);

  const body = useMemo(() => {
    if (confirm.kind === "suspend")
      return "Revokes all their sessions and blocks future logins until unsuspended. Their data is preserved.";
    if (confirm.kind === "delete")
      return "Permanently deletes their account, all files, and all encrypted blobs from R2. Cannot be undone.";
    return confirm.to === "admin"
      ? "Grants access to the admin panel. They can suspend users and view audit logs, but not change roles or delete accounts."
      : "Removes admin access.";
  }, [confirm]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] rounded-[14px] border border-border-primary bg-bg-l2 p-5"
      >
        <h2 className="text-[16px] font-semibold text-text-primary mb-1.5">{title}</h2>
        <p className="text-[13px] text-text-secondary leading-relaxed mb-4">{body}</p>

        {confirm.kind === "suspend" && (
          <div className="mb-4">
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
          </div>
        )}

        {confirm.kind === "delete" && (
          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1.5">
                Type the email to confirm
              </label>
              <input
                type="text"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder={confirm.user.email}
                className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
                autoFocus
              />
            </div>
            <div>
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
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="h-[34px] px-4 rounded-[8px] text-[13px] text-text-secondary hover:bg-cta-secondary-hover transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (confirm.kind === "suspend") onSuspend(reason);
              else if (confirm.kind === "delete") onDelete(confirmEmail, reason);
              else onRole();
            }}
            disabled={
              busy ||
              (confirm.kind === "delete" && confirmEmail !== confirm.user.email)
            }
            className={`h-[34px] px-4 rounded-[8px] text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50 ${
              confirm.kind === "delete"
                ? "text-white bg-accent-red hover:opacity-90"
                : "text-text-inverse bg-cta-primary hover:opacity-90"
            }`}
          >
            {confirm.kind === "delete" ? "Delete permanently" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
