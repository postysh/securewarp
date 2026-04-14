"use client";

import { useEffect, useState } from "react";

type Stats = {
  totalUsers: number;
  newUsers7d: number;
  newUsers30d: number;
  activeUsers7d: number;
  suspendedUsers: number;
  totalFiles: number;
  totalBytes: number;
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(setStats)
      .catch(() => setError("Failed to load stats"));
  }, []);

  const cards: Array<{ label: string; value: string; sub?: string }> = stats
    ? [
        { label: "Total users", value: stats.totalUsers.toLocaleString(), sub: `${stats.newUsers7d} new this week` },
        { label: "Active (7d)", value: stats.activeUsers7d.toLocaleString(), sub: `${((stats.activeUsers7d / Math.max(stats.totalUsers, 1)) * 100).toFixed(0)}% of total` },
        { label: "New users (30d)", value: stats.newUsers30d.toLocaleString() },
        { label: "Suspended", value: stats.suspendedUsers.toLocaleString() },
        { label: "Total files", value: stats.totalFiles.toLocaleString() },
        { label: "Storage used", value: formatBytes(stats.totalBytes) },
      ]
    : [];

  return (
    <div className="max-w-[900px] mx-auto px-8 py-8">
      <header className="mb-8">
        <h1 className="text-[22px] font-semibold text-text-primary">Overview</h1>
        <p className="text-[13px] text-text-tertiary mt-1">App-wide stats. Aggregates refresh on page load.</p>
      </header>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-[8px] bg-accent-yellow-bg text-[13px] text-text-primary">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {(stats ? cards : Array.from({ length: 6 })).map((card, i) => (
          <div
            key={i}
            className="rounded-[12px] border border-border-secondary bg-bg-l2 p-4"
          >
            {stats ? (
              <>
                <div className="text-[11px] font-mono uppercase tracking-wider text-text-disabled mb-1.5">
                  {(card as { label: string }).label}
                </div>
                <div className="text-[24px] font-semibold text-text-primary leading-none">
                  {(card as { value: string }).value}
                </div>
                {(card as { sub?: string }).sub && (
                  <div className="text-[12px] text-text-tertiary mt-2">
                    {(card as { sub?: string }).sub}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="skeleton h-3 w-20 mb-3" />
                <div className="skeleton h-7 w-16" />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
