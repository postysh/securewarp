"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import DollarCircleIcon from "@hugeicons/core-free-icons/DollarCircleIcon";
import UserCheck01Icon from "@hugeicons/core-free-icons/UserCheck01Icon";
import CloudServerIcon from "@hugeicons/core-free-icons/CloudServerIcon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import Mail01Icon from "@hugeicons/core-free-icons/Mail01Icon";
import CreditCardIcon from "@hugeicons/core-free-icons/CreditCardIcon";
import { AdminSidebarToggle } from "../layout";

/**
 * Admin cost dashboard. Three projected totals (day/week/month),
 * per-service breakdown, and a clear split between subscription
 * baseline (what you pay regardless of usage) and usage overage
 * (billed on top). Honest about what's measured vs estimated.
 */

type ServiceLine = {
  name: string;
  sub: string;
  measured: boolean;
  subscription: number;
  overage: number;
  total: number;
  note: string;
};

type Breakdown = {
  workers: number;
  r2: number;
  supabase: number;
  email: number;
  sentry: number;
  stripe: number;
  total: number;
};

type CostsResponse = {
  usage: {
    totalUsers: number;
    active24h: number;
    active7d: number;
    active30d: number;
    totalFiles: number;
    totalWorkspaces: number;
    storageBytes: number;
    storageGB: number;
    chunksThisMonth: number;
    emailsThisMonth: number;
    activePaidSubs: number;
    monthlyRevenueUsd: number;
    estimatedMonthlyWorkerRequests: number;
  };
  services: ServiceLine[];
  estimate: { day: Breakdown; week: Breakdown; month: Breakdown };
  monthly: {
    subscriptionBaseline: number;
    usageOverage: number;
    total: number;
  };
  assumptions: {
    pollRequestsPerMinute: number;
    activeHoursPerDay: number;
    onDemandMultiplier: number;
  };
};

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtUSD(n: number): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function AdminCostsPage() {
  const [data, setData] = useState<CostsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/costs");
        if (!r.ok) throw new Error("Failed to load costs");
        const j = (await r.json()) as CostsResponse;
        setData(j);
      } catch {
        setError("Failed to load costs");
      }
    })();
  }, []);

  return (
    <>
      <div className="relative flex items-center justify-between pl-3 pr-5 h-[52px] shrink-0 border-b border-border-secondary gap-3">
        <div className="flex items-center min-w-0 gap-1.5">
          <AdminSidebarToggle />
          <span className="text-[13px] text-text-primary font-medium ml-1">Cost</span>
          <span className="ml-3 text-[12px] text-text-tertiary">
            Subscription baseline + usage overage
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 md:px-8 py-8">
          {error && (
            <div className="mb-6 px-4 py-3 rounded-[8px] bg-accent-red-bg text-[13px] text-text-primary">
              {error}
            </div>
          )}

          {/* Three projected-bill cards */}
          <section className="mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <TotalCard label="Today" value={data?.estimate.day.total} />
              <TotalCard label="This week" value={data?.estimate.week.total} />
              <TotalCard label="This month" value={data?.estimate.month.total} highlight />
            </div>
          </section>

          {/* Subscription vs overage split — answers "what am I
              locked into paying vs what scales with usage" */}
          <section className="mb-6">
            <div className="rounded-[12px] border border-border-secondary bg-bg-l2 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-[13px] font-semibold text-text-primary">Monthly bill breakdown</h2>
                  <p className="text-[12px] text-text-tertiary mt-0.5">
                    What your subscriptions cost regardless of usage, plus what scales with real volume.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <SplitCard
                  label="Subscription baseline"
                  sublabel="What you pay no matter what"
                  value={data?.monthly.subscriptionBaseline}
                  tone="neutral"
                />
                <SplitCard
                  label="Usage overage"
                  sublabel="Scales with actual volume"
                  value={data?.monthly.usageOverage}
                  tone="neutral"
                />
                <SplitCard
                  label="Total this month"
                  sublabel="Sum of the two"
                  value={data?.monthly.total}
                  tone="highlight"
                />
              </div>
            </div>
          </section>

          {/* Per-service line items */}
          <section className="mb-6">
            <div className="rounded-[12px] border border-border-secondary bg-bg-l2 overflow-hidden">
              <div className="px-5 py-4 border-b border-border-tertiary">
                <h2 className="text-[13px] font-semibold text-text-primary">Per-service breakdown</h2>
                <p className="text-[12px] text-text-tertiary mt-0.5">
                  Measured badges are pulled live from your database; estimated ones use a usage model noted on each row.
                </p>
              </div>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-text-disabled font-mono uppercase tracking-wider">
                    <th className="px-5 py-2 font-normal">Service</th>
                    <th className="px-5 py-2 font-normal text-right">Subscription</th>
                    <th className="px-5 py-2 font-normal text-right">Overage</th>
                    <th className="px-5 py-2 font-normal text-right">Month total</th>
                  </tr>
                </thead>
                <tbody className="text-text-primary">
                  {data?.services.map((s) => (
                    <ServiceRow key={s.name} line={s} />
                  )) ?? (
                    <>
                      <SkeletonRow />
                      <SkeletonRow />
                      <SkeletonRow />
                      <SkeletonRow />
                    </>
                  )}
                  {data && (
                    <tr className="border-t-2 border-border-primary">
                      <td className="px-5 py-3 font-semibold">Total</td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {fmtUSD(data.monthly.subscriptionBaseline)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {fmtUSD(data.monthly.usageOverage)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">
                        {fmtUSD(data.monthly.total)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Usage stats that drive the numbers above */}
          <section className="mb-6">
            <h3 className="text-[11px] font-mono uppercase text-text-disabled tracking-wider mb-3">
              Usage driving the numbers
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <StatCard
                icon={UserGroupIcon}
                accent="var(--accent-blue-primary)"
                label="Total users"
                value={data ? data.usage.totalUsers.toLocaleString() : null}
              />
              <StatCard
                icon={UserCheck01Icon}
                accent="var(--accent-green-primary)"
                label="Active · 24h"
                value={data ? data.usage.active24h.toLocaleString() : null}
              />
              <StatCard
                icon={UserCheck01Icon}
                accent="var(--accent-green-primary)"
                label="Active · 30d"
                value={data ? data.usage.active30d.toLocaleString() : null}
              />
              <StatCard
                icon={CloudServerIcon}
                accent="var(--accent-yellow-primary)"
                label="R2 storage"
                value={data ? formatBytes(data.usage.storageBytes) : null}
                sub={data ? `${data.usage.storageGB.toFixed(2)} GB` : null}
              />
              <StatCard
                icon={File01Icon}
                accent="var(--accent-pink-primary)"
                label="Files"
                value={data ? data.usage.totalFiles.toLocaleString() : null}
              />
              <StatCard
                icon={Mail01Icon}
                accent="var(--accent-orange-primary)"
                label="Emails · mo"
                value={data ? data.usage.emailsThisMonth.toLocaleString() : null}
              />
              <StatCard
                icon={CreditCardIcon}
                accent="var(--accent-dark-blue-primary)"
                label="Paid subs"
                value={data ? data.usage.activePaidSubs.toLocaleString() : null}
                sub={data ? `${fmtUSD(data.usage.monthlyRevenueUsd)} MRR` : null}
              />
              <StatCard
                icon={File01Icon}
                accent="var(--accent-pink-primary)"
                label="Chunks · mo"
                value={data ? data.usage.chunksThisMonth.toLocaleString() : null}
              />
            </div>
          </section>

          {/* Day / week / month per-service grid */}
          <section className="mb-6">
            <div className="rounded-[12px] border border-border-secondary bg-bg-l2 overflow-hidden">
              <div className="px-5 py-4 border-b border-border-tertiary">
                <h2 className="text-[13px] font-semibold text-text-primary">Linear projections</h2>
                <p className="text-[12px] text-text-tertiary mt-0.5">
                  Daily and weekly figures are the monthly projection divided 30× / 30&divide;7×. Providers bill monthly, not daily.
                </p>
              </div>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-text-disabled font-mono uppercase tracking-wider">
                    <th className="px-5 py-2 font-normal">Service</th>
                    <th className="px-5 py-2 font-normal text-right">Today</th>
                    <th className="px-5 py-2 font-normal text-right">This week</th>
                    <th className="px-5 py-2 font-normal text-right">This month</th>
                  </tr>
                </thead>
                <tbody className="text-text-primary">
                  <ScaleRow name="Cloudflare Workers" day={data?.estimate.day.workers} week={data?.estimate.week.workers} month={data?.estimate.month.workers} />
                  <ScaleRow name="Cloudflare R2" day={data?.estimate.day.r2} week={data?.estimate.week.r2} month={data?.estimate.month.r2} />
                  <ScaleRow name="Supabase Pro" day={data?.estimate.day.supabase} week={data?.estimate.week.supabase} month={data?.estimate.month.supabase} />
                  <ScaleRow name="Resend" day={data?.estimate.day.email} week={data?.estimate.week.email} month={data?.estimate.month.email} />
                  <ScaleRow name="Sentry" day={data?.estimate.day.sentry} week={data?.estimate.week.sentry} month={data?.estimate.month.sentry} />
                  <ScaleRow name="Stripe fees" day={data?.estimate.day.stripe} week={data?.estimate.week.stripe} month={data?.estimate.month.stripe} />
                  {data && (
                    <tr className="border-t-2 border-border-primary">
                      <td className="px-5 py-3 font-semibold">Total</td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmtUSD(data.estimate.day.total)}</td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmtUSD(data.estimate.week.total)}</td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">{fmtUSD(data.estimate.month.total)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Footer: honest "where's this from" block */}
          {data && (
            <section className="mb-4">
              <details className="rounded-[12px] border border-border-secondary bg-bg-l2 p-4">
                <summary className="text-[12px] text-text-secondary cursor-pointer select-none">
                  How these numbers are computed
                </summary>
                <div className="mt-3 text-[12px] text-text-tertiary leading-relaxed space-y-2">
                  <p>
                    <strong className="text-text-primary">Measured (pulled live from your DB):</strong>{" "}
                    R2 storage bytes, R2 write operations, emails sent (via security_audit events), active paid subscriptions + MRR, Stripe processing fees.
                  </p>
                  <p>
                    <strong className="text-text-primary">Estimated:</strong>{" "}
                    Cloudflare Worker requests (we don&apos;t log every request; projected from{" "}
                    <code className="text-text-secondary">active_users × {data.assumptions.pollRequestsPerMinute} req/min × 60 × {data.assumptions.activeHoursPerDay}h × {data.assumptions.onDemandMultiplier}× on-demand</code>
                    {" "}= {data.usage.estimatedMonthlyWorkerRequests.toLocaleString()} req/month). For billing-grade accuracy, cross-check the{" "}
                    <a href="https://dash.cloudflare.com" target="_blank" rel="noreferrer" className="text-text-link underline">
                      Cloudflare dashboard
                    </a>
                    {" "}for the current month.
                  </p>
                  <p>
                    <strong className="text-text-primary">Subscription baseline</strong> (the flat floor of your bill):
                    Workers Paid $5/mo, Supabase Pro $25/mo, Resend Pro $20/mo, Sentry Team $26/mo. R2 and Stripe have no subscription — they&apos;re usage-only.
                  </p>
                  <p>
                    <strong className="text-text-primary">Overage rates:</strong> Workers{" "}
                    <code className="text-text-secondary">$0.30/M</code> past 10M, R2 storage{" "}
                    <code className="text-text-secondary">$0.015/GB/mo</code> past 10GB, R2 writes{" "}
                    <code className="text-text-secondary">$4.50/M</code> past 1M, R2 reads{" "}
                    <code className="text-text-secondary">$0.36/M</code> past 10M, Resend{" "}
                    <code className="text-text-secondary">$0.0004/email</code> past 50k, Stripe{" "}
                    <code className="text-text-secondary">2.9% + $0.30</code> per charge.
                  </p>
                  <p className="text-text-disabled">
                    Supabase compute/egress overage and Sentry error overage aren&apos;t tracked inside the app — they would require the Supabase Management API and Sentry API respectively. At our current scale both are typically $0.
                  </p>
                </div>
              </details>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

// ──── UI primitives ─────────────────────────────────────────────

function TotalCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | undefined;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-[12px] border bg-bg-l2 p-5 ${
        highlight ? "border-accent-green/40" : "border-border-secondary"
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-7 h-7 rounded-[8px] flex items-center justify-center"
          style={{
            background: highlight
              ? "color-mix(in srgb, var(--accent-green-primary) 16%, transparent)"
              : "color-mix(in srgb, var(--accent-blue-primary) 16%, transparent)",
          }}
        >
          <HugeiconsIcon
            icon={DollarCircleIcon}
            size={15}
            color={highlight ? "var(--accent-green-primary)" : "var(--accent-blue-primary)"}
          />
        </div>
        <span className="text-[11px] font-mono uppercase tracking-wider text-text-disabled">
          {label}
        </span>
      </div>
      {value === undefined ? (
        <div className="skeleton h-8 w-24" />
      ) : (
        <div className="text-[28px] font-semibold text-text-primary leading-none tabular-nums">
          {fmtUSD(value)}
        </div>
      )}
    </div>
  );
}

function SplitCard({
  label,
  sublabel,
  value,
  tone,
}: {
  label: string;
  sublabel: string;
  value: number | undefined;
  tone: "neutral" | "highlight";
}) {
  const color = tone === "highlight" ? "var(--accent-green-primary)" : "var(--text-primary)";
  return (
    <div className="rounded-[10px] border border-border-tertiary bg-bg-l3 p-4">
      <div className="text-[11px] font-mono uppercase tracking-wider text-text-disabled">
        {label}
      </div>
      <div className="mt-2 text-[22px] font-semibold tabular-nums leading-none" style={{ color }}>
        {value === undefined ? "—" : fmtUSD(value)}
      </div>
      <div className="mt-2 text-[11px] text-text-tertiary">{sublabel}</div>
    </div>
  );
}

function ServiceRow({ line }: { line: ServiceLine }) {
  return (
    <tr className="border-b border-border-tertiary last:border-b-0">
      <td className="px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-text-primary">{line.name}</span>
          <span
            className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${
              line.measured
                ? "bg-accent-green/15 text-accent-green"
                : "bg-accent-yellow/15 text-accent-yellow"
            }`}
          >
            {line.measured ? "measured" : "estimated"}
          </span>
        </div>
        <div className="text-[11px] text-text-tertiary mt-0.5">{line.sub}</div>
        <div className="text-[11px] text-text-disabled mt-1">{line.note}</div>
      </td>
      <td className="px-5 py-3 text-right tabular-nums">
        {line.subscription === 0 ? "—" : fmtUSD(line.subscription)}
      </td>
      <td className="px-5 py-3 text-right tabular-nums">
        {line.overage === 0 ? "—" : fmtUSD(line.overage)}
      </td>
      <td className="px-5 py-3 text-right font-medium tabular-nums">
        {fmtUSD(line.total)}
      </td>
    </tr>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border-tertiary last:border-b-0">
      <td className="px-5 py-3">
        <div className="skeleton h-3.5 w-32 mb-1.5" />
        <div className="skeleton h-2.5 w-24" />
      </td>
      <td className="px-5 py-3 text-right">
        <div className="skeleton h-3 w-12 ml-auto" />
      </td>
      <td className="px-5 py-3 text-right">
        <div className="skeleton h-3 w-12 ml-auto" />
      </td>
      <td className="px-5 py-3 text-right">
        <div className="skeleton h-3 w-12 ml-auto" />
      </td>
    </tr>
  );
}

function ScaleRow({
  name,
  day,
  week,
  month,
}: {
  name: string;
  day: number | undefined;
  week: number | undefined;
  month: number | undefined;
}) {
  return (
    <tr className="border-b border-border-tertiary last:border-b-0">
      <td className="px-5 py-3 text-text-primary">{name}</td>
      <td className="px-5 py-3 text-right tabular-nums">
        {day === undefined ? "—" : fmtUSD(day)}
      </td>
      <td className="px-5 py-3 text-right tabular-nums">
        {week === undefined ? "—" : fmtUSD(week)}
      </td>
      <td className="px-5 py-3 text-right tabular-nums">
        {month === undefined ? "—" : fmtUSD(month)}
      </td>
    </tr>
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
          <div className="text-[24px] font-semibold text-text-primary leading-none tabular-nums">
            {value}
          </div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-text-disabled mt-2">
            {label}
          </div>
          {sub && <div className="text-[11px] text-text-tertiary mt-1">{sub}</div>}
        </>
      )}
    </div>
  );
}
