"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import CreditCardIcon from "@hugeicons/core-free-icons/CreditCardIcon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import UserIcon from "@hugeicons/core-free-icons/UserIcon";
import { AdminSidebarToggle } from "../../layout";

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

function formatMoney(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
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
  const [invoices, setInvoices] = useState<Array<{
    id: string;
    number: string | null;
    createdAt: string;
    status: string;
    paid: boolean;
    totalAmountCents: number;
    currency: string;
    paymentIntent: string | null;
    hostedInvoiceUrl: string | null;
  }> | null>(null);
  const [refundTarget, setRefundTarget] = useState<null | {
    invoiceId: string;
    maxCents: number;
    currency: string;
  }>(null);
  const [refundBusy, setRefundBusy] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditBusy, setCreditBusy] = useState(false);
  const [override, setOverride] = useState<{
    tier_label_override: string | null;
    storage_gb_override: number | null;
    seats_override: number | null;
    workspaces_override: number | null;
    price_cents_override: number | null;
    notes: string | null;
  } | null>(null);
  // Tier-gating: an override on a Free-tier user is stored but
  // dormant. UI shows a warning chip + explanation.
  const [overrideActive, setOverrideActive] = useState(true);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement | null>(null);

  // Close kebab menu on outside click / Escape so it behaves like
  // every other dropdown in the app.
  useEffect(() => {
    if (!actionsOpen) return;
    const onClick = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setActionsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActionsOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [actionsOpen]);

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

  // Billing invoices for this user — loaded once per view. Empty array
  // if the user has no billing_customers row; the UI hides the whole
  // Billing section in that case.
  useEffect(() => {
    fetch(`/api/admin/users/${userId}/invoices`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setInvoices(d.invoices ?? []))
      .catch(() => setInvoices([]));
  }, [userId]);

  // Entitlement override row — admins can stamp per-user custom
  // limits onto any account (storage bump, seat bump, custom label
  // + price for enterprise quotes). Null on the state means either
  // no override is set OR it hasn't loaded yet.
  const loadOverride = useCallback(() => {
    fetch(`/api/admin/users/${userId}/overrides`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        setOverride(d.override ?? null);
        setOverrideActive(Boolean(d.isActive));
      })
      .catch(() => {
        setOverride(null);
        setOverrideActive(true);
      });
  }, [userId]);
  useEffect(() => {
    loadOverride();
  }, [loadOverride]);

  const saveOverride = async (payload: {
    tierLabelOverride: string | null;
    storageGbOverride: number | null;
    seatsOverride: number | null;
    workspacesOverride: number | null;
    priceCentsOverride: number | null;
    notes: string | null;
  }) => {
    setOverrideBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${res.status}`);
      }
      setOverrideOpen(false);
      loadOverride();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setOverrideBusy(false);
    }
  };

  const clearOverride = async () => {
    setOverrideBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/overrides`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${res.status}`);
      }
      setOverride(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clear failed");
    } finally {
      setOverrideBusy(false);
    }
  };

  const issueCredit = async (
    amountCents: number,
    currency: string,
    reason: string,
  ) => {
    setCreditBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/credit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCents,
          currency,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${res.status}`);
      }
      setCreditOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Credit failed");
    } finally {
      setCreditBusy(false);
    }
  };

  const issueRefund = async (
    invoiceId: string,
    amountCents: number | undefined,
    reason: string,
  ) => {
    setRefundBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          ...(amountCents ? { amountCents } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${res.status}`);
      }
      setRefundTarget(null);
      // Refetch invoices so any "refunded" state flips in the UI on
      // the next load cycle. Stripe updates the invoice's refunded
      // flag synchronously with the Refund.create call.
      const r = await fetch(`/api/admin/users/${userId}/invoices`);
      if (r.ok) {
        const d = await r.json();
        setInvoices(d.invoices ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refund failed");
    } finally {
      setRefundBusy(false);
    }
  };

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
      {/* Slim top bar — breadcrumb only. Actions moved to the hero
          kebab menu below so the bar doesn't double as a toolbar. */}
      <div className="relative flex items-center pl-3 pr-5 h-[48px] shrink-0 border-b border-border-secondary gap-2">
        <AdminSidebarToggle />
        <Link
          href="/admin/users"
          className="p-1.5 rounded-md text-icon-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer"
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} size={16} />
        </Link>
        <span className="text-[12px] text-text-tertiary">Users</span>
        <span className="text-text-disabled">/</span>
        <span className="text-[12px] text-text-primary font-medium truncate">
          {detail?.user.email ?? "Loading…"}
        </span>
      </div>

      {error && (
        <div className="mx-6 md:mx-8 mt-4 px-4 py-3 rounded-[8px] bg-accent-yellow-bg text-[13px] text-text-primary">
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
          <div className="px-6 md:px-8 py-7 space-y-7">
            {/* Banner — user identity block with a color-tinted
                surface (derived from the email-hash palette the app
                already uses for avatars). Matches the Workspace
                Settings Overview banner so admins move between those
                pages without a visual genre shift. */}
            <div
              className="relative rounded-[12px] px-5 py-5"
              style={{
                background: `color-mix(in srgb, ${colorForEmail(detail.user.email)} 12%, var(--bg-overlay-tertiary))`,
                border: "1px solid var(--border-tertiary)",
              }}
            >
              <div className="flex items-start gap-4">
                <div
                  className="w-12 h-12 rounded-[10px] flex items-center justify-center text-[18px] font-bold text-white shrink-0"
                  style={{ backgroundColor: colorForEmail(detail.user.email) }}
                >
                  {detail.user.email[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <h1 className="text-[16px] font-semibold text-text-primary truncate">
                      {detail.user.email}
                    </h1>
                    <span
                      className={`px-1.5 py-0.5 rounded-[5px] text-[10px] font-mono uppercase tracking-wider ${
                        detail.user.role === "owner"
                          ? "bg-accent-green-bg text-accent-green"
                          : detail.user.role === "admin"
                          ? "bg-accent-yellow-bg text-accent-yellow"
                          : "bg-bg-field text-text-tertiary"
                      }`}
                    >
                      {detail.user.role}
                    </span>
                    {detail.user.suspendedAt && (
                      <span className="px-1.5 py-0.5 rounded-[5px] text-[10px] font-mono uppercase tracking-wider bg-accent-red/10 text-accent-red">
                        suspended
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-text-secondary font-mono">{detail.user.id}</p>
                </div>
                {canActOnUser() && (
                  <div className="relative shrink-0" ref={actionsRef}>
                  <button
                    onClick={() => setActionsOpen((v) => !v)}
                    disabled={busy}
                    className="flex items-center justify-center w-[34px] h-[34px] rounded-[8px] text-text-secondary hover:bg-cta-nav-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
                  </button>
                  {actionsOpen && (
                    <div className="absolute right-0 top-[38px] z-10 min-w-[200px] rounded-[10px] border border-border-secondary bg-bg-l3 shadow-[var(--shadow-l2)] overflow-hidden animate-fade-in">
                      {detail.user.suspendedAt ? (
                        <button
                          onClick={() => {
                            setActionsOpen(false);
                            unsuspend();
                          }}
                          disabled={busy}
                          className="flex items-center gap-2.5 w-full px-3 h-[36px] text-[12px] text-text-primary hover:bg-cta-nav-hover transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <HugeiconsIcon icon={PlayCircleIcon} size={14} className="text-text-tertiary" />
                          Unsuspend
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setActionsOpen(false);
                            setConfirm({ kind: "suspend" });
                          }}
                          disabled={busy}
                          className="flex items-center gap-2.5 w-full px-3 h-[36px] text-[12px] text-text-primary hover:bg-cta-nav-hover transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <HugeiconsIcon icon={StopCircleIcon} size={14} className="text-text-tertiary" />
                          Suspend
                        </button>
                      )}
                      {me?.role === "owner" && (
                        <>
                          <div className="h-px bg-border-tertiary" />
                          <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-text-disabled">
                            Role
                          </div>
                          {(["user", "admin", "owner"] as Role[]).map((r) => (
                            <button
                              key={r}
                              onClick={() => {
                                setActionsOpen(false);
                                if (r !== detail.user.role) setConfirm({ kind: "role", to: r });
                              }}
                              disabled={busy || r === detail.user.role}
                              className="flex items-center gap-2.5 w-full px-3 h-[32px] text-[12px] text-text-primary hover:bg-cta-nav-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
                            >
                              <HugeiconsIcon icon={UserIcon} size={14} className="text-text-tertiary" />
                              <span className="flex-1 text-left">{r}</span>
                              {r === detail.user.role && (
                                <span className="text-[10px] font-mono uppercase tracking-wider text-text-disabled">current</span>
                              )}
                            </button>
                          ))}
                          <div className="h-px bg-border-tertiary" />
                          <button
                            onClick={() => {
                              setActionsOpen(false);
                              setConfirm({ kind: "delete" });
                            }}
                            disabled={busy}
                            className="flex items-center gap-2.5 w-full px-3 h-[36px] text-[12px] text-accent-red hover:bg-accent-red/10 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <HugeiconsIcon icon={Delete02Icon} size={14} />
                            Delete user…
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                )}
              </div>
              {/* Banner footer — creation + last-login metadata
                  pinned under a divider, matching the Workspace
                  Settings banner pattern. */}
              <div className="mt-4 pt-4 border-t border-border-tertiary flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-text-disabled">
                <span>Joined {formatFullDate(detail.user.createdAt)}</span>
                <span>Last login {formatRelative(detail.user.lastLoginAt)}</span>
                {detail.user.suspendedAt && detail.user.suspendedReason && (
                  <span className="text-accent-red">Reason: {detail.user.suspendedReason}</span>
                )}
              </div>
            </div>

            {/* At-a-glance stats — rendered as a bordered list with a
                rounded color dot + label + right-aligned mono value.
                Matches the "Breakdown" pattern used in Settings →
                Storage and Workspace Settings → Overview so the
                admin panel feels like the rest of the app. */}
            <div>
              <p className="text-[10px] font-mono uppercase text-text-disabled tracking-wider mb-2">Breakdown</p>
              <div className="rounded-[10px] border border-border-tertiary overflow-hidden">
                {[
                  {
                    label: "Files",
                    value: `${detail.usage.fileCount.toLocaleString()}${detail.usage.trashedCount > 0 ? ` (${detail.usage.trashedCount.toLocaleString()} in trash)` : ""}`,
                    color: "rgb(100,170,220)",
                  },
                  {
                    label: "Storage",
                    value: `${formatBytes(detail.usage.totalBytes)}${detail.usage.trashedBytes > 0 ? ` (+${formatBytes(detail.usage.trashedBytes)} trash)` : ""}`,
                    color: "rgb(210,180,80)",
                  },
                  {
                    label: "Active sessions",
                    value: detail.sessions.length === 0 ? "None" : detail.sessions.length.toLocaleString(),
                    color: "rgb(200,140,175)",
                  },
                  {
                    label: "Invoices",
                    value:
                      invoices === null
                        ? "—"
                        : invoices.length === 0
                          ? "Free tier"
                          : invoices.length.toLocaleString(),
                    color: "rgb(239,90,60)",
                  },
                ].map((r) => (
                  <div
                    key={r.label}
                    className="flex items-center gap-3 px-3 py-3 border-b border-border-tertiary last:border-b-0"
                  >
                    <div className="w-[10px] h-[10px] rounded-[3px] shrink-0" style={{ backgroundColor: r.color }} />
                    <div className="flex-1">
                      <p className="text-[12px] text-text-primary">{r.label}</p>
                    </div>
                    <span className="text-[12px] text-text-secondary font-mono tabular-nums">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Body: two equal columns. Left holds actionable stuff
                (Billing, Notes). Right holds reference stuff
                (Activity, Sessions). Stacks on narrow viewports. */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left column: Plan override, Billing, Notes */}
              <div className="space-y-6 min-w-0">
                {/* Plan override — admin-stamped per-user limits for
                    custom deals. Shows "no override" state with a
                    "Set override" button when empty; expands into a
                    small bordered list with the set values + edit /
                    clear buttons when active. */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[10px] font-mono uppercase text-text-disabled tracking-wider">
                      Plan override
                    </p>
                    {override !== null && !overrideActive && (
                      <span
                        className="px-1.5 py-0.5 rounded-[4px] text-[9px] font-mono uppercase tracking-wider bg-accent-yellow-bg text-accent-yellow"
                        title="User is on Free tier. Override is stored but not enforced. It will reactivate automatically if they resubscribe."
                      >
                        Dormant
                      </span>
                    )}
                  </div>
                  <div className="rounded-[10px] border border-border-tertiary overflow-hidden">
                    {override === null ? (
                      <div className="flex items-center justify-between px-3 py-3">
                        <span className="text-[12px] text-text-tertiary">
                          No override. This user uses the default tier limits.
                        </span>
                        <button
                          onClick={() => setOverrideOpen(true)}
                          className="flex items-center h-[26px] px-2.5 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-cta-nav-hover border border-border-secondary transition-colors cursor-pointer"
                        >
                          Set override
                        </button>
                      </div>
                    ) : (
                      <>
                        {[
                          { label: "Plan label", value: override.tier_label_override ?? "—" },
                          { label: "Storage", value: override.storage_gb_override !== null ? `${override.storage_gb_override.toLocaleString()} GB` : "—" },
                          { label: "Seats", value: override.seats_override !== null ? override.seats_override.toLocaleString() : "—" },
                          { label: "Workspaces", value: override.workspaces_override !== null ? override.workspaces_override.toLocaleString() : "—" },
                          { label: "Price", value: override.price_cents_override !== null ? `$${(override.price_cents_override / 100).toFixed(2)}/mo` : "—" },
                        ].map((r) => (
                          <div key={r.label} className="flex items-center justify-between px-3 py-2.5 border-b border-border-tertiary">
                            <span className="text-[12px] text-text-secondary">{r.label}</span>
                            <span className="text-[12px] text-text-primary font-mono tabular-nums">{r.value}</span>
                          </div>
                        ))}
                        {override.notes && (
                          <div className="px-3 py-2.5 border-b border-border-tertiary text-[11px] text-text-tertiary italic">
                            {override.notes}
                          </div>
                        )}
                        <div className="flex items-center justify-end gap-2 px-3 py-2">
                          <button
                            onClick={clearOverride}
                            disabled={overrideBusy}
                            className="flex items-center h-[26px] px-2.5 rounded-[6px] text-[11px] font-medium text-accent-red hover:bg-cta-nav-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {overrideBusy ? "Clearing…" : "Clear"}
                          </button>
                          <button
                            onClick={() => setOverrideOpen(true)}
                            disabled={overrideBusy}
                            className="flex items-center h-[26px] px-2.5 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-cta-nav-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50"
                          >
                            Edit
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Billing */}
                {invoices && invoices.length > 0 && (
                  <div className="rounded-[12px] border border-border-secondary bg-bg-l2 overflow-hidden">
                    <div className="flex items-center gap-2 px-5 h-[44px] border-b border-border-secondary">
                      <HugeiconsIcon icon={CreditCardIcon} size={14} className="text-accent-green-primary" />
                      <h2 className="text-[13px] font-semibold text-text-primary">
                        Billing ({invoices.length} invoice{invoices.length === 1 ? "" : "s"})
                      </h2>
                      <button
                        onClick={() => setCreditOpen(true)}
                        className="ml-auto flex items-center h-[26px] px-2.5 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-cta-nav-hover border border-border-secondary transition-colors cursor-pointer"
                      >
                        Issue credit
                      </button>
                    </div>
                    <ul>
                      {invoices.map((inv) => (
                        <li
                          key={inv.id}
                          className="flex items-center justify-between gap-3 px-5 h-[52px] border-b border-border-tertiary last:border-b-0"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[12px] text-text-primary font-medium">
                              {formatFullDate(inv.createdAt)}
                            </div>
                            <div className="text-[11px] text-text-tertiary font-mono truncate">
                              {inv.number ?? inv.id}
                            </div>
                          </div>
                          <span className="text-[12px] text-text-secondary font-mono tabular-nums shrink-0">
                            {formatMoney(inv.totalAmountCents, inv.currency)}
                          </span>
                          {inv.hostedInvoiceUrl && (
                            <a
                              href={inv.hostedInvoiceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center h-[26px] px-2.5 rounded-[6px] text-[11px] font-medium text-text-tertiary hover:bg-cta-nav-hover border border-border-secondary transition-colors shrink-0"
                            >
                              View
                            </a>
                          )}
                          <button
                            onClick={() =>
                              setRefundTarget({
                                invoiceId: inv.id,
                                maxCents: inv.totalAmountCents,
                                currency: inv.currency,
                              })
                            }
                            disabled={!inv.paid || !inv.paymentIntent}
                            title={
                              !inv.paid
                                ? "Only paid invoices can be refunded"
                                : !inv.paymentIntent
                                  ? "No refundable payment on this invoice"
                                  : "Refund"
                            }
                            className="flex items-center h-[26px] px-2.5 rounded-[6px] text-[11px] font-medium text-accent-red hover:bg-cta-nav-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                          >
                            Refund
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* Notes */}
                <div className="rounded-[12px] border border-border-secondary bg-bg-l2 overflow-hidden">
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
                </div>

              </div>

              {/* Right column: reference info (Activity + Sessions).
                  Storage card is gone — its numbers live in the KPI
                  strip above. */}
              <aside className="space-y-6 min-w-0">
                {/* Recent activity (audit) */}
                <div className="rounded-[12px] border border-border-secondary bg-bg-l2 overflow-hidden">
                  <div className="px-5 h-[44px] flex items-center border-b border-border-secondary">
                    <h2 className="text-[13px] font-semibold text-text-primary">
                      Recent activity ({detail.audit.length})
                    </h2>
                  </div>
                  {detail.audit.length === 0 ? (
                    <div className="py-8 text-center text-[12px] text-text-tertiary">No events.</div>
                  ) : (
                    <ul className="max-h-[360px] overflow-y-auto">
                      {detail.audit.map((e) => (
                        <li
                          key={e.id}
                          className="flex items-start gap-4 px-5 py-3 border-b border-border-tertiary last:border-b-0"
                        >
                          <div className="w-[80px] text-[11px] text-text-tertiary tabular-nums shrink-0 pt-0.5">
                            {formatRelative(e.occurred_at)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-[12px] text-text-primary truncate">{e.event_type}</div>
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
              </aside>
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
      {refundTarget && (
        <RefundModal
          invoiceId={refundTarget.invoiceId}
          maxCents={refundTarget.maxCents}
          currency={refundTarget.currency}
          busy={refundBusy}
          onCancel={() => setRefundTarget(null)}
          onConfirm={(amount, reason) => issueRefund(refundTarget.invoiceId, amount, reason)}
        />
      )}
      {creditOpen && (
        <CreditModal
          defaultCurrency={invoices?.[0]?.currency ?? "usd"}
          busy={creditBusy}
          onCancel={() => setCreditOpen(false)}
          onConfirm={issueCredit}
        />
      )}
      {overrideOpen && (
        <OverrideModal
          initial={override}
          busy={overrideBusy}
          onCancel={() => setOverrideOpen(false)}
          onConfirm={saveOverride}
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
        Reason (shown to the user)
      </label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        placeholder="e.g. Violation of our terms of service"
        className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
        autoFocus
      />
      <p className="mt-1.5 text-[11px] text-text-tertiary">
        This text appears on the user&apos;s login page if they try to sign in. Keep it clear and professional.
      </p>
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

function RefundModal({
  invoiceId,
  maxCents,
  currency,
  busy,
  onCancel,
  onConfirm,
}: {
  invoiceId: string;
  maxCents: number;
  currency: string;
  busy: boolean;
  onCancel: () => void;
  // amountCents omitted (undefined) = full refund. Any value ≤ maxCents = partial.
  onConfirm: (amountCents: number | undefined, reason: string) => void;
}) {
  // Default to the full amount expressed as a decimal so the admin
  // sees the refundable total filled in. They can edit down for a
  // partial refund or leave it to refund everything.
  const [amountStr, setAmountStr] = useState((maxCents / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const amountNum = Number.parseFloat(amountStr);
  const amountCents = Number.isFinite(amountNum) ? Math.round(amountNum * 100) : NaN;
  const valid = Number.isFinite(amountCents) && amountCents > 0 && amountCents <= maxCents;
  const isFull = amountCents === maxCents;
  return (
    <Modal onCancel={onCancel} title="Issue refund">
      <p className="text-[13px] text-text-secondary leading-relaxed mb-4">
        Refund invoice <span className="font-mono text-text-primary">{invoiceId}</span>. Money returns to the customer&apos;s original payment method. This action is recorded in the admin audit log.
      </p>
      <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1">
        Amount ({currency.toUpperCase()}) — max {(maxCents / 100).toFixed(2)}
      </label>
      <input
        type="number"
        step="0.01"
        min="0"
        max={(maxCents / 100).toFixed(2)}
        value={amountStr}
        onChange={(e) => setAmountStr(e.target.value)}
        className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary border border-transparent focus:border-border-primary focus:outline-none mb-3"
      />
      <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1">
        Reason (optional)
      </label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. customer requested via support email"
        maxLength={500}
        className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
      />
      <ModalFooter
        busy={busy}
        disabled={!valid}
        onCancel={onCancel}
        onConfirm={() => onConfirm(isFull ? undefined : amountCents, reason)}
        confirmLabel={isFull ? "Refund in full" : `Refund ${amountStr}`}
        danger
      />
    </Modal>
  );
}

function OverrideModal({
  initial,
  busy,
  onCancel,
  onConfirm,
}: {
  initial: {
    tier_label_override: string | null;
    storage_gb_override: number | null;
    seats_override: number | null;
    workspaces_override: number | null;
    price_cents_override: number | null;
    notes: string | null;
  } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (payload: {
    tierLabelOverride: string | null;
    storageGbOverride: number | null;
    seatsOverride: number | null;
    workspacesOverride: number | null;
    priceCentsOverride: number | null;
    notes: string | null;
  }) => void;
}) {
  // Fields are string-typed at the input level so users can clear a
  // value to empty = inherit tier default. Converted to number at
  // submit time.
  const [label, setLabel] = useState(initial?.tier_label_override ?? "");
  const [storage, setStorage] = useState(initial?.storage_gb_override != null ? String(initial.storage_gb_override) : "");
  const [seats, setSeats] = useState(initial?.seats_override != null ? String(initial.seats_override) : "");
  const [workspaces, setWorkspaces] = useState(initial?.workspaces_override != null ? String(initial.workspaces_override) : "");
  const [price, setPrice] = useState(initial?.price_cents_override != null ? (initial.price_cents_override / 100).toFixed(2) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const toIntOrNull = (s: string): number | null => {
    const t = s.trim();
    if (!t) return null;
    const n = Number.parseInt(t, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const toPriceCentsOrNull = (s: string): number | null => {
    const t = s.trim();
    if (!t) return null;
    const n = Number.parseFloat(t);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  };

  return (
    <Modal onCancel={onCancel} title="Plan override">
      <p className="text-[13px] text-text-secondary leading-relaxed mb-4">
        Leave a field empty to inherit the user&apos;s tier default. The override is enforced across every entitlement check (quota, seats, workspaces). For a custom-priced deal, configure the Stripe subscription separately — this screen only records the display price.
      </p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="col-span-2">
          <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1">Plan label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Enterprise"
            maxLength={40}
            className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1">Storage (GB)</label>
          <input
            type="number"
            min="1"
            value={storage}
            onChange={(e) => setStorage(e.target.value)}
            placeholder="inherit"
            className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1">Seats</label>
          <input
            type="number"
            min="1"
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            placeholder="inherit"
            className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1">Workspaces</label>
          <input
            type="number"
            min="1"
            value={workspaces}
            onChange={(e) => setWorkspaces(e.target.value)}
            placeholder="inherit"
            className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1">Price (USD/mo)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="inherit"
            className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
          />
        </div>
      </div>
      <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1">Notes</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Why this override exists — support ticket, contract ref, etc."
        maxLength={2000}
        rows={2}
        className="w-full px-3 py-2 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none resize-none"
      />
      <ModalFooter
        busy={busy}
        onCancel={onCancel}
        onConfirm={() =>
          onConfirm({
            tierLabelOverride: label.trim() || null,
            storageGbOverride: toIntOrNull(storage),
            seatsOverride: toIntOrNull(seats),
            workspacesOverride: toIntOrNull(workspaces),
            priceCentsOverride: toPriceCentsOrNull(price),
            notes: notes.trim() || null,
          })
        }
        confirmLabel="Save override"
      />
    </Modal>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="rounded-[12px] border border-border-secondary bg-bg-l2 px-4 py-3.5">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1.5">
        <HugeiconsIcon icon={icon} size={12} />
        {label}
      </div>
      <div className="text-[22px] font-semibold text-text-primary tabular-nums leading-none">
        {value}
      </div>
      {sub && <div className="text-[11px] text-text-tertiary mt-1.5">{sub}</div>}
    </div>
  );
}

function CreditModal({
  defaultCurrency,
  busy,
  onCancel,
  onConfirm,
}: {
  defaultCurrency: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (amountCents: number, currency: string, reason: string) => void;
}) {
  const [amountStr, setAmountStr] = useState("");
  const [reason, setReason] = useState("");
  const amountNum = Number.parseFloat(amountStr);
  const amountCents = Number.isFinite(amountNum) ? Math.round(amountNum * 100) : NaN;
  const valid = Number.isFinite(amountCents) && amountCents > 0 && amountCents <= 100_000;
  return (
    <Modal onCancel={onCancel} title="Issue account credit">
      <p className="text-[13px] text-text-secondary leading-relaxed mb-4">
        Adds a credit to the customer&apos;s Stripe balance. It does not go back to their card. Stripe automatically applies it against their next invoice. Use this for goodwill, outage compensation, or topping up an earlier refund.
      </p>
      <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1">
        Amount ({defaultCurrency.toUpperCase()}) — max 1000.00
      </label>
      <input
        type="number"
        step="0.01"
        min="0"
        max="1000"
        value={amountStr}
        onChange={(e) => setAmountStr(e.target.value)}
        placeholder="0.00"
        className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none mb-3"
      />
      <label className="block text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1">
        Reason (optional)
      </label>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. apology for the March 2026 outage"
        maxLength={500}
        className="w-full h-[34px] px-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
      />
      <ModalFooter
        busy={busy}
        disabled={!valid}
        onCancel={onCancel}
        onConfirm={() => onConfirm(amountCents, defaultCurrency, reason)}
        confirmLabel={valid ? `Issue ${amountStr} credit` : "Issue credit"}
      />
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
