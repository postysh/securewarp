import "server-only";
import { supabase } from "./supabase";

/**
 * Transparency report aggregation. Computes the numbers the public
 * /transparency page renders from three sources:
 *   - file_reports (abuse reports received)
 *   - admin_audit (actions taken on reports)
 *   - law_enforcement_requests (legal process served)
 *
 * Everything here is metadata-only. We never touch file contents.
 */

export type ReportCategory =
  | "csam"
  | "harassment"
  | "malware"
  | "copyright"
  | "illegal"
  | "other";

/**
 * Small-number banding. Exact counts below 5 are suppressed to
 * "< 5" because combining a tiny exact count with externally
 * visible signals (link revocation dates, account creation
 * timestamps) could identify a specific case. Zero is preserved
 * because it's meaningful and non-identifying.
 */
export function band(count: number): string {
  if (count === 0) return "0";
  if (count < 5) return "< 5";
  return String(count);
}

export interface TransparencyReport {
  periodStart: string;
  periodEnd: string;
  inProgress: boolean;
  generatedAt: string;
  reports: {
    byCategory: Record<ReportCategory, number>;
    total: number;
  };
  actions: {
    linksRevoked: number;
    evidenceHoldsPlaced: number;
    accountsSuspended: number;
    reportsDismissed: number;
    accountsBanned: number;
    ncmecReportsFiled: number;
  };
  lawEnforcement: {
    byType: {
      subpoenaUs: number;
      warrantUs: number;
      preservationUs: number;
      mlat: number;
      nsl: number;
      other: number;
    };
    byOutcome: {
      produced: number;
      challenged: number;
      rejected: number;
      pending: number;
    };
    total: number;
  };
}

/**
 * Default reporting window — calendar year to date. A future
 * "publish snapshot" flow will pass in a frozen window; until then
 * the page always reflects the current year.
 */
export function defaultPeriod(now: Date = new Date()): {
  periodStart: string;
  periodEnd: string;
} {
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return {
    periodStart: yearStart.toISOString(),
    periodEnd: now.toISOString(),
  };
}

export async function aggregateTransparency(
  periodStart: string,
  periodEnd: string,
): Promise<TransparencyReport> {
  // ── Reports by category ────────────────────────────────────
  const { data: reportRows } = await supabase
    .from("file_reports")
    .select("category")
    .gte("created_at", periodStart)
    .lte("created_at", periodEnd);

  const byCategory: Record<ReportCategory, number> = {
    csam: 0,
    harassment: 0,
    malware: 0,
    copyright: 0,
    illegal: 0,
    other: 0,
  };
  for (const r of reportRows ?? []) {
    const cat = r.category as ReportCategory;
    if (cat in byCategory) byCategory[cat]++;
  }
  const reportsTotal = (reportRows ?? []).length;

  // ── Admin actions on reports ───────────────────────────────
  // admin_audit uses `occurred_at` as the timestamp column. We
  // filter by action prefix `report.` to isolate T&S activity from
  // the rest of the admin surface (user role changes, workspace
  // edits, etc.).
  const { data: auditRows } = await supabase
    .from("admin_audit")
    .select("action")
    .gte("occurred_at", periodStart)
    .lte("occurred_at", periodEnd)
    .like("action", "report.%");

  const actionCounts = {
    linksRevoked: 0,
    evidenceHoldsPlaced: 0,
    accountsSuspended: 0,
    accountsBanned: 0,
  };
  for (const r of auditRows ?? []) {
    switch (r.action) {
      case "report.revoke-link":
        actionCounts.linksRevoked++;
        break;
      case "report.evidence-hold":
        actionCounts.evidenceHoldsPlaced++;
        break;
      case "report.suspend-uploader":
        actionCounts.accountsSuspended++;
        break;
      case "report.ban-uploader":
        actionCounts.accountsBanned++;
        break;
    }
  }

  // Reports dismissed + escalated during the period. We filter on
  // `handled_at` since that's when the status change happened.
  const { data: closedRows } = await supabase
    .from("file_reports")
    .select("status, category")
    .not("handled_at", "is", null)
    .gte("handled_at", periodStart)
    .lte("handled_at", periodEnd);

  let reportsDismissed = 0;
  let ncmecReportsFiled = 0;
  for (const r of closedRows ?? []) {
    if (r.status === "dismissed") reportsDismissed++;
    if (r.status === "escalated" && r.category === "csam") {
      ncmecReportsFiled++;
    }
  }

  // ── Law enforcement requests ────────────────────────────────
  const { data: leRows } = await supabase
    .from("law_enforcement_requests")
    .select("type, status")
    .gte("received_at", periodStart)
    .lte("received_at", periodEnd);

  const leByType = {
    subpoenaUs: 0,
    warrantUs: 0,
    preservationUs: 0,
    mlat: 0,
    nsl: 0,
    other: 0,
  };
  const leByOutcome = {
    produced: 0,
    challenged: 0,
    rejected: 0,
    pending: 0,
  };
  for (const r of leRows ?? []) {
    switch (r.type) {
      case "subpoena-us": leByType.subpoenaUs++; break;
      case "warrant-us": leByType.warrantUs++; break;
      case "preservation-us": leByType.preservationUs++; break;
      case "mlat": leByType.mlat++; break;
      case "nsl": leByType.nsl++; break;
      default: leByType.other++; break;
    }
    switch (r.status) {
      case "produced": leByOutcome.produced++; break;
      case "challenged": leByOutcome.challenged++; break;
      case "rejected": leByOutcome.rejected++; break;
      case "pending":
      default: leByOutcome.pending++; break;
    }
  }

  const now = new Date();
  const inProgress = new Date(periodEnd) >= now;

  return {
    periodStart,
    periodEnd,
    inProgress,
    generatedAt: now.toISOString(),
    reports: {
      byCategory,
      total: reportsTotal,
    },
    actions: {
      ...actionCounts,
      reportsDismissed,
      ncmecReportsFiled,
    },
    lawEnforcement: {
      byType: leByType,
      byOutcome: leByOutcome,
      total: (leRows ?? []).length,
    },
  };
}
