"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";

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
  return d.toISOString().slice(0, 16).replace("T", " ") + "Z";
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
    <div className="max-w-[1100px] mx-auto px-8 py-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold text-text-primary">Audit log</h1>
          <p className="text-[13px] text-text-tertiary mt-1">
            Security events and admin actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-[8px] border border-border-secondary overflow-hidden h-[34px]">
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
              className="h-[34px] w-[200px] pl-8 pr-3 rounded-[8px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
            />
          </div>
        </div>
      </header>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-[8px] bg-accent-yellow-bg text-[13px] text-text-primary">
          {error}
        </div>
      )}

      <div className="rounded-[12px] border border-border-secondary bg-bg-l2 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-[11px] font-mono uppercase tracking-wider text-text-disabled border-b border-border-secondary">
              <th className="text-left font-normal px-4 py-3 w-[110px]">When</th>
              <th className="text-left font-normal px-4 py-3 w-[90px]">Type</th>
              <th className="text-left font-normal px-4 py-3">Event</th>
              <th className="text-left font-normal px-4 py-3">Actor</th>
              <th className="text-left font-normal px-4 py-3">Target</th>
              <th className="text-left font-normal px-4 py-3">Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="text-center py-12 text-[13px] text-text-tertiary">
                  No events match.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr
                key={e.id}
                className="border-b border-border-tertiary last:border-b-0 text-[13px]"
              >
                <td className="px-4 py-3 text-text-tertiary tabular-nums">{formatTime(e.occurredAt)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-[6px] text-[11px] font-mono uppercase tracking-wider ${
                      e.kind === "admin"
                        ? "bg-accent-yellow-bg text-accent-yellow"
                        : "bg-bg-overlay-tertiary text-text-tertiary"
                    }`}
                  >
                    {e.kind}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-[12px] text-text-primary">{e.event}</td>
                <td className="px-4 py-3 text-text-secondary truncate max-w-[180px]">
                  {e.actorEmail ?? <span className="text-text-disabled">—</span>}
                </td>
                <td className="px-4 py-3 text-text-secondary truncate max-w-[180px]">
                  {e.targetEmail ?? <span className="text-text-disabled">—</span>}
                </td>
                <td className="px-4 py-3 text-text-tertiary truncate max-w-[260px]" title={e.detail ?? ""}>
                  {e.detail ?? <span className="text-text-disabled">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {loading && (
          <div className="py-4 text-center text-[12px] text-text-tertiary">Loading…</div>
        )}
      </div>

      {nextCursor && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => load(nextCursor, source, q, false)}
            disabled={loading}
            className="h-[34px] px-5 rounded-[8px] text-[13px] font-medium text-text-secondary border border-border-secondary hover:bg-cta-secondary-hover transition-colors cursor-pointer disabled:opacity-50"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
