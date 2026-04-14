"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import ArrowRight02Icon from "@hugeicons/core-free-icons/ArrowRight02Icon";

type Entry = {
  kind: "security" | "admin";
  id: string;
  occurredAt: string;
  event: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorRole?: string;
  targetUserId: string | null;
  targetEmail: string | null;
  detail: string | null;
};

type Source = "all" | "security" | "admin";

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toISOString().slice(0, 10);
}

// Deterministic color-for-email — same hash used on the users page.
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

function UserChip({ email }: { email: string | null }) {
  if (!email) return <span className="text-[12px] text-text-disabled">—</span>;
  return (
    <div className="flex items-center gap-2 min-w-0" title={email}>
      <div
        className="w-5 h-5 rounded-[5px] flex items-center justify-center text-[9px] font-bold text-white shrink-0"
        style={{ backgroundColor: colorForEmail(email) }}
      >
        {email[0].toUpperCase()}
      </div>
      <span className="text-[12px] text-text-secondary truncate">{email}</span>
    </div>
  );
}

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor: string | null, src: Source, query: string, replace: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (src !== "all") params.set("source", src);
      if (query) params.set("q", query);
      const res = await fetch(`/api/admin/audit?${params.toString()}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setEntries((prev) => (replace ? data.entries : [...prev, ...data.entries]));
      setNextCursor(data.nextCursor);
    } catch {
      setError("Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(null, source, q, true), 300);
    return () => clearTimeout(t);
  }, [source, q, load]);

  return (
    <>
      {/* Header bar */}
      <div className="relative flex items-center justify-between px-5 h-[52px] shrink-0 border-b border-border-secondary gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[13px] text-text-primary font-medium">Audit log</span>
          <span className="text-[12px] text-text-tertiary">Security events and admin actions</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex rounded-[8px] border border-border-secondary overflow-hidden h-[32px]">
            {(["all", "security", "admin"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSource(s)}
                className={`px-3 text-[12px] transition-colors cursor-pointer ${
                  source === s
                    ? "bg-bg-overlay-tertiary text-text-primary"
                    : "text-text-tertiary hover:bg-cta-nav-hover"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="relative">
            <HugeiconsIcon
              icon={Search01Icon}
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter…"
              className="h-[32px] w-[200px] pl-8 pr-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-3 px-4 py-3 rounded-[8px] bg-accent-yellow-bg text-[13px] text-text-primary">
          {error}
        </div>
      )}

      {/* Column header row */}
      {entries.length > 0 && (
        <div className="hidden md:flex items-center h-[40px] px-4 mx-3 md:mx-5 box-border select-none shrink-0 border-b border-border-tertiary">
          <div className="flex items-center flex-1 min-w-0 pr-4">
            <span className="text-[11px] font-mono uppercase text-text-disabled">Event</span>
          </div>
          <div className="flex items-center gap-[46px]">
            <div className="w-[70px] flex justify-end">
              <span className="text-[11px] font-mono uppercase text-text-disabled">Type</span>
            </div>
            <div className="w-[170px] hidden md:flex justify-start">
              <span className="text-[11px] font-mono uppercase text-text-disabled">Actor</span>
            </div>
            <div className="w-[170px] hidden lg:flex justify-start">
              <span className="text-[11px] font-mono uppercase text-text-disabled">Target</span>
            </div>
            <div className="w-[90px] flex justify-end">
              <span className="text-[11px] font-mono uppercase text-text-disabled">When</span>
            </div>
          </div>
        </div>
      )}

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-3 md:px-5 pt-1 pb-4">
        {entries.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-24">
            <h3 className="text-[15px] font-medium text-text-primary mb-1">No events match</h3>
            <p className="text-[12px] text-text-tertiary">Try a different source or filter.</p>
          </div>
        )}

        {entries.map((e) => (
          <div
            key={e.id}
            className="group relative flex items-center h-[52px] px-4 rounded-[8px] transition-colors hover:bg-bg-cell-hover"
          >
            {/* Event identity — mono event name stacked with detail subtitle */}
            <div className="flex items-center flex-1 min-w-0 pr-4 gap-3">
              <div
                className={`w-1 h-7 rounded-full shrink-0 ${
                  e.kind === "admin" ? "bg-accent-yellow" : "bg-bg-overlay-tertiary"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[12px] text-text-primary truncate">{e.event}</div>
                {e.detail && (
                  <div className="text-[11px] text-text-tertiary truncate mt-0.5" title={e.detail}>
                    {e.detail}
                  </div>
                )}
              </div>
            </div>

            {/* Metadata columns */}
            <div className="hidden md:flex items-center gap-[46px]">
              <div className="w-[70px] flex justify-end">
                <span
                  className={`flex h-5 items-center justify-center rounded bg-bg-field px-1.5 py-0.5 text-[11px] font-mono uppercase ${
                    e.kind === "admin" ? "text-accent-yellow" : "text-text-disabled"
                  }`}
                >
                  {e.kind}
                </span>
              </div>
              <div className="w-[170px] hidden md:flex justify-start min-w-0">
                <UserChip email={e.actorEmail} />
              </div>
              <div className="w-[170px] hidden lg:flex items-center justify-start min-w-0 gap-1.5">
                {e.targetEmail ? (
                  <>
                    <HugeiconsIcon icon={ArrowRight02Icon} size={11} className="text-text-disabled shrink-0" />
                    <UserChip email={e.targetEmail} />
                  </>
                ) : (
                  <span className="text-[12px] text-text-disabled">—</span>
                )}
              </div>
              <div className="w-[90px] flex justify-end">
                <span className="text-[12px] text-text-disabled tabular-nums">{formatTime(e.occurredAt)}</span>
              </div>
            </div>
          </div>
        ))}

        {loading && entries.length === 0 && (
          <div className="py-8 text-center text-[12px] text-text-tertiary">Loading…</div>
        )}

        {nextCursor && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => load(nextCursor, source, q, false)}
              disabled={loading}
              className="h-[32px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50"
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </>
  );
}
