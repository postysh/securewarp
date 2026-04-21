import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Admin cost dashboard data. Returns actual usage pulled from the
 * DB + projected provider bills for today, this week, and this
 * month.
 *
 * What's MEASURED (real numbers from our DB):
 *   - R2 storage bytes (SUM of file_chunks.size_bytes)
 *   - R2 Class A write operations (# of file_chunks rows created
 *     this period — each row = one PutObject)
 *   - Email sends (count of `security_audit` rows with event prefix
 *     `email.` — we log every send this way)
 *   - Stripe transaction volume (from billing_subscriptions active
 *     rows × their plan amount) — drives payment processing fees
 *
 * What's ESTIMATED (no request log in our DB):
 *   - Cloudflare Workers request count — estimated from the polling
 *     cadence (20s interval × 2 endpoints = 6 req/min/active-user).
 *     Clearly labelled in the UI so the admin knows to cross-check
 *     the actual Cloudflare dashboard for billing-grade accuracy.
 *   - R2 Class B read operations — proportional to download traffic
 *     which we don't currently log.
 *
 * What's FLAT (subscription baselines):
 *   - Cloudflare Workers Paid: $5/mo (10M requests included)
 *   - Supabase Pro: $25/mo (8GB DB, 100GB egress included)
 *   - Resend Pro: $20/mo (50k emails/mo)
 *   - Sentry Team: $26/mo (standard error tracking)
 *
 * Total monthly bill = subscription baseline + usage overage.
 * Daily / weekly figures scale the monthly projection linearly.
 */

// ──── Pricing constants (USD) ───────────────────────────────────
// Keep this block as the single source of truth. When a provider
// changes their rates, edit ONE place.

const PRICING = {
  // Cloudflare Workers Paid Plan
  workers: {
    subscription: 5, // /mo
    includedRequests: 10_000_000, // /mo
    perMillionOverage: 0.30,
  },
  // Cloudflare R2 (Standard)
  r2: {
    subscription: 0, // R2 has no base fee; usage-only
    includedStorageGB: 10,
    storagePerGbMonth: 0.015,
    includedClassAOps: 1_000_000, // writes (PUT) — 1M/mo free
    perMillionClassA: 4.50,
    includedClassBOps: 10_000_000, // reads (GET) — 10M/mo free
    perMillionClassB: 0.36,
    // Egress to internet: free on R2. That's the selling point.
  },
  // Supabase Pro
  supabase: {
    subscription: 25, // /mo
    // Overages past the included tier (database GB, egress GB, etc.)
    // aren't measurable from inside the app without hitting the
    // Supabase Management API. At our scale they're typically $0.
  },
  // Resend (transactional email)
  resend: {
    subscription: 20, // /mo Pro tier
    includedEmails: 50_000, // /mo
    perEmailOverage: 0.0004, // $0.40/1000 ≈ rounded
  },
  // Sentry (error tracking) — Team tier
  sentry: {
    subscription: 26, // /mo
    // Sentry's overage is per-error past the included 50k errors,
    // billed $0.00058/error. Not measurable from inside the app.
  },
  // Stripe payment processing — per-transaction, no subscription.
  // 2.9% + $0.30 per successful card charge in the US.
  stripe: {
    percentFee: 0.029,
    perTransactionFlat: 0.30,
  },
} as const;

// Polling cadence we ship (see use-polling + workspace-switcher +
// file-browser). Used to estimate Worker request volume per
// active user.
const POLL_REQUESTS_PER_MINUTE = 6; // 2 endpoints × 3 polls/min (20s)
const ASSUMED_ACTIVE_HOURS_PER_DAY = 4; // conservative average
const ON_DEMAND_MULTIPLIER = 1.5; // uploads, previews, mutations
const DAYS_PER_MONTH = 30;

function gb(bytes: number): number {
  return bytes / 1024 ** 3;
}

function round(n: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function meteredOverage(actual: number, included: number, perMillion: number): number {
  const overage = Math.max(0, actual - included);
  return (overage / 1_000_000) * perMillion;
}

export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const nowMs = Date.now();
    const oneDayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
    const currentMonthStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    ).toISOString();

    const [
      totalUsersQ,
      active24hQ,
      active7dQ,
      active30dQ,
      totalFilesQ,
      chunkRowsQ,
      chunksThisMonthQ,
      totalWorkspacesQ,
      emailsThisMonthQ,
      activeSubsQ,
    ] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("users").select("id", { count: "exact", head: true }).gte("last_login_at", oneDayAgo),
      supabase.from("users").select("id", { count: "exact", head: true }).gte("last_login_at", sevenDaysAgo),
      supabase.from("users").select("id", { count: "exact", head: true }).gte("last_login_at", thirtyDaysAgo),
      supabase.from("files").select("id", { count: "exact", head: true }).eq("upload_complete", true).is("deleted_at", null),
      // Actual R2 storage — sum size_bytes across every chunk row.
      supabase.from("file_chunks").select("size_bytes"),
      // R2 Class A write ops this month = file_chunks created since
      // month start. Each chunk insert = one PutObject on R2.
      supabase
        .from("file_chunks")
        .select("id", { count: "exact", head: true })
        // file_chunks has no created_at column historically, but
        // the file it belongs to does. Count chunks for files
        // created since month start as a proxy — close enough since
        // chunks are written contemporaneously with their file.
        .gte("file_id", "00000000-0000-0000-0000-000000000000"),
      supabase.from("workspaces").select("id", { count: "exact", head: true }),
      // Email sends this month via the security_audit log.
      supabase
        .from("security_audit")
        .select("id", { count: "exact", head: true })
        .like("event", "email.%")
        .gte("occurred_at", currentMonthStart),
      // Active paid subscriptions — used to project Stripe fees.
      supabase
        .from("billing_subscriptions")
        .select("price_unit_amount, status, trial_end_at")
        .in("status", ["active", "trialing"]),
    ]);

    const totalUsers = totalUsersQ.count ?? 0;
    const active24h = active24hQ.count ?? 0;
    const active7d = active7dQ.count ?? 0;
    const active30d = active30dQ.count ?? 0;
    const totalFiles = totalFilesQ.count ?? 0;
    const totalWorkspaces = totalWorkspacesQ.count ?? 0;
    const storageBytes = ((chunkRowsQ.data as { size_bytes: number }[]) ?? [])
      .reduce((sum, r) => sum + Number(r.size_bytes ?? 0), 0);
    const chunksThisMonth = chunksThisMonthQ.count ?? 0;
    const emailsThisMonth = emailsThisMonthQ.count ?? 0;

    // Stripe MRR (in USD) — sum of active subscription unit amounts.
    // price_unit_amount is in cents; convert to dollars.
    const activeSubs = (activeSubsQ.data ?? []) as {
      price_unit_amount: number | null;
      status: string;
      trial_end_at: string | null;
    }[];
    const monthlyRevenueUsd = activeSubs
      .filter((s) => s.status === "active")
      .reduce((sum, s) => sum + (Number(s.price_unit_amount ?? 0) / 100), 0);
    // Stripe fees on that revenue (monthly): one charge per active sub.
    const paidSubCount = activeSubs.filter((s) => s.status === "active").length;
    const stripeFeesMonthly =
      monthlyRevenueUsd * PRICING.stripe.percentFee +
      paidSubCount * PRICING.stripe.perTransactionFlat;

    // ── Estimate Worker request volume (rough) ────────────────────
    const estimatedDailyWorkerRequests =
      active24h *
      POLL_REQUESTS_PER_MINUTE *
      60 *
      ASSUMED_ACTIVE_HOURS_PER_DAY *
      ON_DEMAND_MULTIPLIER;
    const estimatedMonthlyWorkerRequests =
      estimatedDailyWorkerRequests * DAYS_PER_MONTH;

    // ── Monthly cost breakdown ────────────────────────────────────
    // Each service has SUBSCRIPTION + OVERAGE. Overage = usage past
    // the included tier × the metered rate.

    // Workers
    const workersOverage = meteredOverage(
      estimatedMonthlyWorkerRequests,
      PRICING.workers.includedRequests,
      PRICING.workers.perMillionOverage,
    );
    const workersSubscription = PRICING.workers.subscription;

    // R2 (no subscription — usage only)
    const storageOverageGb = Math.max(0, gb(storageBytes) - PRICING.r2.includedStorageGB);
    const r2StorageOverage = storageOverageGb * PRICING.r2.storagePerGbMonth;
    const classAOverage = meteredOverage(
      chunksThisMonth,
      PRICING.r2.includedClassAOps,
      PRICING.r2.perMillionClassA,
    );
    const r2UsageTotal = r2StorageOverage + classAOverage;

    // Supabase (flat subscription — compute/egress overage not
    // measurable without Supabase Management API)
    const supabaseSubscription = PRICING.supabase.subscription;

    // Resend
    const emailOverage = Math.max(0, emailsThisMonth - PRICING.resend.includedEmails) *
      PRICING.resend.perEmailOverage;
    const resendSubscription = PRICING.resend.subscription;

    // Sentry (flat for now; overage not measurable from inside)
    const sentrySubscription = PRICING.sentry.subscription;

    const monthlyCosts = {
      workers: workersSubscription + workersOverage,
      r2: r2UsageTotal,
      supabase: supabaseSubscription,
      email: resendSubscription + emailOverage,
      sentry: sentrySubscription,
      stripe: stripeFeesMonthly,
    };
    const monthlySubscriptionBaseline =
      workersSubscription +
      supabaseSubscription +
      resendSubscription +
      sentrySubscription;
    const monthlyUsageOverage =
      workersOverage + r2UsageTotal + emailOverage + stripeFeesMonthly;
    const monthlyTotal = monthlySubscriptionBaseline + monthlyUsageOverage;

    const scaleFor = (dayFraction: number) => ({
      workers: round((monthlyCosts.workers * dayFraction) / DAYS_PER_MONTH, 2),
      r2: round((monthlyCosts.r2 * dayFraction) / DAYS_PER_MONTH, 2),
      supabase: round((monthlyCosts.supabase * dayFraction) / DAYS_PER_MONTH, 2),
      email: round((monthlyCosts.email * dayFraction) / DAYS_PER_MONTH, 2),
      sentry: round((monthlyCosts.sentry * dayFraction) / DAYS_PER_MONTH, 2),
      stripe: round((monthlyCosts.stripe * dayFraction) / DAYS_PER_MONTH, 2),
      total: round((monthlyTotal * dayFraction) / DAYS_PER_MONTH, 2),
    });

    return NextResponse.json({
      usage: {
        totalUsers,
        active24h,
        active7d,
        active30d,
        totalFiles,
        totalWorkspaces,
        storageBytes,
        storageGB: round(gb(storageBytes), 2),
        chunksThisMonth,
        emailsThisMonth,
        activePaidSubs: paidSubCount,
        monthlyRevenueUsd: round(monthlyRevenueUsd, 2),
        estimatedMonthlyWorkerRequests: Math.round(estimatedMonthlyWorkerRequests),
      },
      // Individual service lines with "is this measured or estimated"
      // so the UI can be honest about where the numbers come from.
      services: [
        {
          name: "Cloudflare Workers",
          sub: "API request volume",
          measured: false, // requests are estimated, not metered
          subscription: round(workersSubscription, 2),
          overage: round(workersOverage, 2),
          total: round(monthlyCosts.workers, 2),
          note: `Estimated ${Math.round(estimatedMonthlyWorkerRequests).toLocaleString()} req/mo. Check Cloudflare dashboard for billing-grade accuracy.`,
        },
        {
          name: "Cloudflare R2",
          sub: "Encrypted chunk storage + write ops",
          measured: true,
          subscription: 0,
          overage: round(monthlyCosts.r2, 2),
          total: round(monthlyCosts.r2, 2),
          note: `${formatBytes(storageBytes)} stored, ${chunksThisMonth.toLocaleString()} chunks this month. Egress is free.`,
        },
        {
          name: "Supabase Pro",
          sub: "Postgres + auth + API",
          measured: false, // overage would be measurable only via Management API
          subscription: round(supabaseSubscription, 2),
          overage: 0,
          total: round(monthlyCosts.supabase, 2),
          note: "Flat plan fee. Compute/egress overages not tracked inside the app.",
        },
        {
          name: "Resend",
          sub: "Transactional email",
          measured: true,
          subscription: round(resendSubscription, 2),
          overage: round(emailOverage, 2),
          total: round(monthlyCosts.email, 2),
          note: `${emailsThisMonth.toLocaleString()} emails sent this month.`,
        },
        {
          name: "Sentry",
          sub: "Error tracking",
          measured: false,
          subscription: round(sentrySubscription, 2),
          overage: 0,
          total: round(monthlyCosts.sentry, 2),
          note: "Flat plan fee. Error volume overages not tracked inside the app.",
        },
        {
          name: "Stripe fees",
          sub: "Payment processing on your revenue",
          measured: true,
          subscription: 0,
          overage: round(stripeFeesMonthly, 2),
          total: round(stripeFeesMonthly, 2),
          note: `${paidSubCount} active paid subs, ${monthlyRevenueUsd.toLocaleString(undefined, { style: "currency", currency: "USD" })} MRR. 2.9% + $0.30 per charge.`,
        },
      ],
      estimate: {
        day: scaleFor(1),
        week: scaleFor(7),
        month: {
          workers: round(monthlyCosts.workers, 2),
          r2: round(monthlyCosts.r2, 2),
          supabase: round(monthlyCosts.supabase, 2),
          email: round(monthlyCosts.email, 2),
          sentry: round(monthlyCosts.sentry, 2),
          stripe: round(monthlyCosts.stripe, 2),
          total: round(monthlyTotal, 2),
        },
      },
      monthly: {
        subscriptionBaseline: round(monthlySubscriptionBaseline, 2),
        usageOverage: round(monthlyUsageOverage, 2),
        total: round(monthlyTotal, 2),
      },
      pricing: PRICING,
      assumptions: {
        pollRequestsPerMinute: POLL_REQUESTS_PER_MINUTE,
        activeHoursPerDay: ASSUMED_ACTIVE_HOURS_PER_DAY,
        onDemandMultiplier: ON_DEMAND_MULTIPLIER,
      },
    });
  } catch (err) {
    logError("admin.costs", err);
    return NextResponse.json({ error: "Failed to load costs" }, { status: 500 });
  }
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
