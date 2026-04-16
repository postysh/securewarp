"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import UserCheck01Icon from "@hugeicons/core-free-icons/UserCheck01Icon";
import UserMinus01Icon from "@hugeicons/core-free-icons/UserMinus01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import CloudServerIcon from "@hugeicons/core-free-icons/CloudServerIcon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import SecurityLockIcon from "@hugeicons/core-free-icons/SecurityLockIcon";
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon";
import ArrowRight02Icon from "@hugeicons/core-free-icons/ArrowRight02Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import Key02Icon from "@hugeicons/core-free-icons/Key02Icon";
import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon";
import { AdminSidebarToggle } from "./layout";

type Stats = {
  totalUsers: number;
  newUsers7d: number;
  newUsers30d: number;
  activeUsers7d: number;
  suspendedUsers: number;
  totalFiles: number;
  totalBytes: number;
  // Security
  totpEnabled: number;
  activeSessions: number;
  failedLogins7d: number;
  rateLimitHits: number;
};

type Overview = {
  latestSignups: Array<{
    id: string;
    email: string;
    role: string;
    createdAt: string;
    suspendedAt: string | null;
  }>;
  latestAdminActions: Array<{
    id: number;
    occurredAt: string;
    action: string;
    actorEmail: string | null;
    targetEmail: string | null;
    detail: string | null;
  }>;
  signupsByDay: Array<{ day: string; count: number }>;
};

type Health = {
  supabase: { ok: boolean; latencyMs: number | null };
  r2: { ok: boolean };
  crons: {
    cleanupStale: { lastRunAt: string | null; fresh: boolean };
    expireTrash: { lastRunAt: string | null; fresh: boolean };
  };
};

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatRelative(iso: string): string {
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

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [securityEvents, setSecurityEvents] = useState<Array<{
    id: string;
    occurredAt: string;
    event: string;
    actorUserId: string | null;
    detail: string | null;
  }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/stats").then((r) => (r.ok ? r.json() : Promise.reject(r))),
      fetch("/api/admin/overview").then((r) => (r.ok ? r.json() : Promise.reject(r))),
      fetch("/api/admin/health").then((r) => (r.ok ? r.json() : Promise.reject(r))),
      fetch("/api/admin/audit?source=security&q=fail").then((r) => (r.ok ? r.json() : { entries: [] })),
    ])
      .then(([s, o, h, audit]) => {
        setStats(s);
        setOverview(o);
        setHealth(h);
        setSecurityEvents((audit.entries ?? []).slice(0, 8));
      })
      .catch(() => setError("Failed to load dashboard"));
  }, []);

  const maxSignupCount = overview
    ? Math.max(...overview.signupsByDay.map((d) => d.count), 1)
    : 1;

  return (
    <>
      {/* Header bar */}
      <div className="relative flex items-center justify-between pl-3 pr-5 h-[52px] shrink-0 border-b border-border-secondary gap-3">
        <div className="flex items-center min-w-0 gap-1.5">
          <AdminSidebarToggle />
          <span className="text-[13px] text-text-primary font-medium ml-1">Overview</span>
          <span className="ml-3 text-[12px] text-text-tertiary">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </span>
        </div>
        {health && <HealthStrip health={health} />}
      </div>

      {/* Scrollable content — uses full card width so the dashboard fills
          the viewport on wide monitors. */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 md:px-8 py-8">
          {error && (
            <div className="mb-6 px-4 py-3 rounded-[8px] bg-accent-yellow-bg text-[13px] text-text-primary">
              {error}
            </div>
          )}

          {/* User lookup */}
          <UserLookup />


          {/* Primary stat row — 2 cols on mobile, 3 on tablet, 6 on wide
              desktop so the row fills full width without stretching each
              card into a billboard. */}
          <section className="mb-6">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <StatCard
                icon={UserGroupIcon}
                accent="var(--accent-blue-primary)"
                label="Total users"
                value={stats ? stats.totalUsers.toLocaleString() : null}
                sub={stats ? `${stats.newUsers7d} this week` : null}
              />
              <StatCard
                icon={UserCheck01Icon}
                accent="var(--accent-green-primary)"
                label="Active · 7d"
                value={stats ? stats.activeUsers7d.toLocaleString() : null}
                sub={
                  stats
                    ? `${((stats.activeUsers7d / Math.max(stats.totalUsers, 1)) * 100).toFixed(0)}% of total`
                    : null
                }
              />
              <StatCard
                icon={UserAdd01Icon}
                accent="var(--accent-dark-blue-primary)"
                label="New · 30d"
                value={stats ? stats.newUsers30d.toLocaleString() : null}
              />
              <StatCard
                icon={UserMinus01Icon}
                accent="var(--accent-red-primary)"
                label="Suspended"
                value={stats ? stats.suspendedUsers.toLocaleString() : null}
              />
              <StatCard
                icon={File01Icon}
                accent="var(--accent-pink-primary)"
                label="Files"
                value={stats ? stats.totalFiles.toLocaleString() : null}
              />
              <StatCard
                icon={CloudServerIcon}
                accent="var(--accent-yellow-primary)"
                label="Storage"
                value={stats ? formatBytes(stats.totalBytes) : null}
              />
            </div>
          </section>

          {/* Security stats */}
          <section className="mb-6">
            <h3 className="text-[11px] font-mono uppercase text-text-disabled tracking-wider mb-3">Security</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                icon={Shield01Icon}
                accent="var(--accent-green-primary)"
                label="2FA enabled"
                value={stats ? stats.totpEnabled.toLocaleString() : null}
                sub={
                  stats
                    ? `${((stats.totpEnabled / Math.max(stats.totalUsers, 1)) * 100).toFixed(0)}% adoption`
                    : null
                }
              />
              <StatCard
                icon={Key02Icon}
                accent="var(--accent-blue-primary)"
                label="Active sessions"
                value={stats ? stats.activeSessions.toLocaleString() : null}
              />
              <StatCard
                icon={SecurityLockIcon}
                accent="var(--accent-orange-primary)"
                label="Failed logins · 7d"
                value={stats ? stats.failedLogins7d.toLocaleString() : null}
              />
              <StatCard
                icon={Alert02Icon}
                accent="var(--accent-red-primary)"
                label="Rate limit hits"
                value={stats ? stats.rateLimitHits.toLocaleString() : null}
                sub="active blocks"
              />
            </div>
          </section>

          {/* Growth histogram — dedicated full-width section. Number
              breakdowns moved into the top stat row above. */}
          <section className="mb-6">
            <div className="rounded-[12px] border border-border-secondary bg-bg-l2 p-5">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-[13px] font-semibold text-text-primary">Signups</h2>
                  <p className="text-[12px] text-text-tertiary mt-0.5">Last 14 days</p>
                </div>
                <div className="flex items-end gap-6">
                  <div className="text-right">
                    <div className="text-[11px] font-mono uppercase tracking-wider text-text-disabled">7d</div>
                    <div className="text-[20px] font-semibold text-text-primary tabular-nums leading-none mt-1">
                      {stats ? stats.newUsers7d.toLocaleString() : "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] font-mono uppercase tracking-wider text-text-disabled">30d</div>
                    <div className="text-[20px] font-semibold text-text-primary tabular-nums leading-none mt-1">
                      {stats ? stats.newUsers30d.toLocaleString() : "—"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Full-width histogram — taller bars to make the shape
                  readable on wide screens. */}
              <div className="flex items-end gap-[4px] h-[96px]">
                {(overview?.signupsByDay ?? Array.from({ length: 14 }).map(() => ({ day: "", count: 0 }))).map((d, i) => {
                  const h = overview ? Math.max((d.count / maxSignupCount) * 90, d.count > 0 ? 8 : 3) : 3;
                  return (
                    <div
                      key={i}
                      title={overview ? `${d.day}: ${d.count} signup${d.count === 1 ? "" : "s"}` : ""}
                      className="flex-1 rounded-[4px] transition-all min-w-0"
                      style={{
                        height: `${h}px`,
                        background: overview && d.count > 0
                          ? "var(--accent-green-primary)"
                          : "var(--bg-overlay-tertiary)",
                        opacity: overview ? (d.count > 0 ? 0.85 : 0.4) : 0.3,
                      }}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between mt-3 text-[10px] font-mono uppercase tracking-wider text-text-disabled">
                <span>14 days ago</span>
                <span>today</span>
              </div>
            </div>
          </section>

          {/* Recent activity panels — two columns on desktop, full width
              when it's the last row on the page. */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Recent signups */}
            <Panel
              title="Recent signups"
              icon={UserAdd01Icon}
              href="/admin/users"
              hrefLabel="All users"
            >
              {!overview ? (
                <SkeletonRows />
              ) : overview.latestSignups.length === 0 ? (
                <EmptyRow text="No signups yet." />
              ) : (
                <ul>
                  {overview.latestSignups.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center justify-between gap-3 px-4 h-[44px] border-b border-border-tertiary last:border-b-0"
                    >
                      <div className="min-w-0 flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-bg-overlay-tertiary flex items-center justify-center text-[10px] font-mono uppercase text-text-secondary shrink-0">
                          {u.email[0]}
                        </div>
                        <div className="text-[13px] text-text-primary truncate">{u.email}</div>
                      </div>
                      <div className="text-[11px] text-text-tertiary shrink-0 tabular-nums">
                        {formatRelative(u.createdAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* Recent admin actions */}
            <Panel
              title="Recent admin actions"
              icon={SecurityLockIcon}
              href="/admin/audit"
              hrefLabel="Full log"
            >
              {!overview ? (
                <SkeletonRows />
              ) : overview.latestAdminActions.length === 0 ? (
                <EmptyRow text="No admin actions yet." />
              ) : (
                <ul>
                  {overview.latestAdminActions.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 px-4 h-[44px] border-b border-border-tertiary last:border-b-0"
                    >
                      <div className="min-w-0">
                        <div className="text-[12px] font-mono text-text-primary truncate">{a.action}</div>
                        <div className="text-[11px] text-text-tertiary truncate">
                          {a.actorEmail ?? "—"}
                          {a.targetEmail ? ` → ${a.targetEmail}` : ""}
                        </div>
                      </div>
                      <div className="text-[11px] text-text-tertiary shrink-0 tabular-nums">
                        {formatRelative(a.occurredAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {/* Recent security events */}
            <Panel
              title="Security events"
              icon={Alert02Icon}
              href="/admin/audit"
              hrefLabel="Full log"
            >
              {!securityEvents ? (
                <SkeletonRows />
              ) : securityEvents.length === 0 ? (
                <EmptyRow text="No security events this week." />
              ) : (
                <ul>
                  {securityEvents.map((ev) => (
                    <li
                      key={ev.id}
                      className="flex items-center justify-between gap-3 px-4 h-[44px] border-b border-border-tertiary last:border-b-0"
                    >
                      <div className="min-w-0 flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${
                          ev.event.includes("fail") ? "bg-accent-red" : "bg-accent-yellow"
                        }`} />
                        <div className="text-[12px] text-text-secondary truncate font-mono">
                          {ev.event}
                        </div>
                        {ev.detail && (
                          <div className="text-[11px] text-text-disabled truncate hidden md:block">
                            {ev.detail}
                          </div>
                        )}
                      </div>
                      <div className="text-[11px] text-text-tertiary shrink-0 tabular-nums">
                        {formatRelative(ev.occurredAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>
        </div>
      </div>
    </>
  );
}

function StatCard({
  icon,
  accent,
  label,
  value,
  sub,
}: {
  icon: typeof UserGroupIcon;
  accent: string;
  label: string;
  value: string | null;
  sub?: string | null;
}) {
  return (
    <div className="rounded-[12px] border border-border-secondary bg-bg-l2 p-4">
      <div className="flex items-center justify-between mb-3">
        <div
          className="w-7 h-7 rounded-[8px] flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)` }}
        >
          <HugeiconsIcon icon={icon} size={15} color={accent} />
        </div>
      </div>
      {value === null ? (
        <>
          <div className="skeleton h-7 w-20 mb-2" />
          <div className="skeleton h-3 w-16" />
        </>
      ) : (
        <>
          <div className="text-[24px] font-semibold text-text-primary leading-none tabular-nums">{value}</div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-text-disabled mt-2">{label}</div>
          {sub && <div className="text-[11px] text-text-tertiary mt-1">{sub}</div>}
        </>
      )}
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between">
      <div>
        <h2 className="text-[14px] font-semibold text-text-primary">{title}</h2>
        {subtitle && <p className="text-[12px] text-text-tertiary mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function Panel({
  title,
  icon,
  href,
  hrefLabel,
  children,
}: {
  title: string;
  icon: typeof UserGroupIcon;
  href: string;
  hrefLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[12px] border border-border-secondary bg-bg-l2 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 h-[44px] border-b border-border-secondary">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={icon} size={14} className="text-text-tertiary" />
          <h3 className="text-[13px] font-semibold text-text-primary">{title}</h3>
        </div>
        <Link
          href={href}
          className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-primary transition-colors"
        >
          {hrefLabel}
          <HugeiconsIcon icon={ArrowRight02Icon} size={11} />
        </Link>
      </div>
      <div className="min-h-[220px]">{children}</div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <ul>
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 h-[44px] border-b border-border-tertiary last:border-b-0">
          <div className="skeleton w-6 h-6 rounded-full" />
          <div className="skeleton h-3 flex-1 max-w-[160px]" />
          <div className="skeleton h-3 w-12" />
        </li>
      ))}
    </ul>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-[12px] text-text-tertiary">
      <HugeiconsIcon icon={Clock01Icon} size={14} className="mr-2" />
      {text}
    </div>
  );
}

function UserLookup() {
  // Debounced typeahead. Hits /api/admin/users?search=... which already
  // supports ILIKE matching. Results drop straight into a floating menu
  // with Enter-to-jump to /admin/users/[id].
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; email: string }>>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (term: string) => {
    if (!term.trim()) {
      setResults([]);
      return;
    }
    try {
      const params = new URLSearchParams({ search: term });
      const res = await fetch(`/api/admin/users?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setResults(
        (data.users ?? []).slice(0, 6).map((u: { id: string; email: string }) => ({
          id: u.id,
          email: u.email,
        }))
      );
      setHi(0);
    } catch {
      /* swallow */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(q), 200);
    return () => clearTimeout(t);
  }, [q, search]);

  const jump = (id: string) => {
    setOpen(false);
    setQ("");
    router.push(`/admin/users/${id}`);
  };

  return (
    <div className="relative mb-6 max-w-[520px]">
      <HugeiconsIcon
        icon={Search01Icon}
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
      />
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
        onKeyDown={(e) => {
          if (!results.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            jump(results[hi].id);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Find a user by email…"
        className="w-full h-[38px] pl-9 pr-3 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
      />
      {open && q.trim() && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 rounded-[10px] border border-border-primary bg-bg-l3 z-40 overflow-hidden"
          style={{ boxShadow: "var(--shadow-l2)" }}
        >
          {results.map((r, i) => (
            <button
              key={r.id}
              onMouseDown={(e) => {
                e.preventDefault();
                jump(r.id);
              }}
              onMouseEnter={() => setHi(i)}
              className={`w-full text-left px-3 h-[34px] flex items-center gap-2 text-[13px] transition-colors cursor-pointer ${
                i === hi ? "bg-cta-nav-active text-text-primary" : "text-text-secondary hover:bg-cta-nav-hover"
              }`}
            >
              <HugeiconsIcon icon={UserGroupIcon} size={13} className="text-text-tertiary shrink-0" />
              <span className="truncate">{r.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HealthStrip({ health }: { health: Health }) {
  // Each pill: colored dot + tiny label. Green = healthy, yellow = stale
  // (cron hasn't fired in >36h), red = down. Clicking does nothing for
  // now — we can later drill into a /admin/health page.
  const pills: Array<{ label: string; state: "ok" | "warn" | "down"; tip: string }> = [
    {
      label: "Supabase",
      state: health.supabase.ok ? "ok" : "down",
      tip: health.supabase.ok
        ? `Reachable (${health.supabase.latencyMs ?? "?"} ms)`
        : "Supabase unreachable",
    },
    {
      label: "R2",
      state: health.r2.ok ? "ok" : "down",
      tip: health.r2.ok ? "Credentials present" : "R2 env vars missing",
    },
    {
      label: "Cleanup cron",
      state: health.crons.cleanupStale.fresh
        ? "ok"
        : health.crons.cleanupStale.lastRunAt
        ? "warn"
        : "down",
      tip: health.crons.cleanupStale.lastRunAt
        ? `Last run ${new Date(health.crons.cleanupStale.lastRunAt).toISOString()}`
        : "Has never run",
    },
    {
      label: "Trash cron",
      state: health.crons.expireTrash.fresh
        ? "ok"
        : health.crons.expireTrash.lastRunAt
        ? "warn"
        : "down",
      tip: health.crons.expireTrash.lastRunAt
        ? `Last run ${new Date(health.crons.expireTrash.lastRunAt).toISOString()}`
        : "Has never run",
    },
  ];

  const dotColor = (state: "ok" | "warn" | "down") =>
    state === "ok"
      ? "var(--accent-green-primary)"
      : state === "warn"
      ? "var(--accent-yellow-primary)"
      : "var(--accent-red-primary)";

  return (
    <div className="hidden md:flex items-center gap-3 shrink-0">
      {pills.map((p) => (
        <div key={p.label} title={p.tip} className="flex items-center gap-1.5">
          <span
            className="w-[7px] h-[7px] rounded-full shrink-0"
            style={{ background: dotColor(p.state) }}
          />
          <span className="text-[11px] font-mono uppercase tracking-wider text-text-disabled">
            {p.label}
          </span>
        </div>
      ))}
    </div>
  );
}
