"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { HugeiconsIcon } from "@hugeicons/react";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";

/**
 * Self-contained Plan & billing panel rendered inside the Settings
 * modal. Fetches /api/billing/status, shows the user's current tier
 * card with meter progress bars, handles the inline upgrade flow via
 * Stripe Elements (Payment Element), and — when on a paid tier —
 * surfaces cancel/resume, update-payment-method, and invoices list.
 *
 * Stripe.js is dynamically imported and cached across renders via a
 * module-level `stripePromise`, so switching tabs doesn't refetch the
 * JS bundle.
 */

type Tier = "free" | "plus" | "pro";

interface TierInfo {
  id: Tier;
  label: string;
  priceCents: number;
  storageGB: number;
  seats: number | null;
  workspaces: number | null;
}

interface Status {
  tier: Tier;
  subscription: { status: string; currentPeriodEnd: string | null } | null;
  usage: { storageGB: number; storageBytes: number; seats: number; workspaces: number };
  limits: { storageGB: number; seats: number | null; workspaces: number | null; priceCents: number; label: string };
  tiers: TierInfo[];
}

interface SubscriptionDetail {
  id: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}

interface Invoice {
  id: string;
  number: string | null;
  createdAt: string;
  status: string;
  paid: boolean;
  totalAmountCents: number;
  currency: string;
}

let stripePromise: Promise<StripeJs | null> | null = null;
function getStripe(): Promise<StripeJs | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) return Promise.resolve(null);
    stripePromise = loadStripe(key);
  }
  return stripePromise;
}

export function PlanBillingPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [detail, setDetail] = useState<SubscriptionDetail | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [pendingTier, setPendingTier] = useState<"plus" | "pro" | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  // When a paid subscriber picks a different tier we need to show
  // a confirm dialog BEFORE calling change-plan — Stripe charges
  // the existing payment method immediately, so the user has to
  // opt in explicitly. `changeConfirmTier` != null opens the
  // dialog; null means idle.
  const [changeConfirmTier, setChangeConfirmTier] = useState<"plus" | "pro" | null>(null);
  const [changingBusy, setChangingBusy] = useState(false);
  // Track the Stripe subscription id the checkout creates so we can
  // void it if the user bails before confirming payment — otherwise
  // the dashboard fills up with "incomplete" subscriptions + open
  // invoices from abandoned clicks.
  const [pendingSubId, setPendingSubId] = useState<string | null>(null);
  const abandonCheckout = useCallback(async (subId: string | null) => {
    if (!subId) return;
    try {
      await fetch("/api/billing/checkout-abandon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: subId }),
      });
    } catch { /* best-effort — the stale-incomplete cleanup in the
                 next /api/billing/checkout call is a backstop. */ }
  }, []);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/status");
      if (res.ok) {
        const data = await res.json();
        if (data?.tier) setStatus(data);
      }
    } catch { /* */ }
  }, []);

  const confirmChangePlan = useCallback(async () => {
    if (!changeConfirmTier || changingBusy) return;
    setChangingBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: changeConfirmTier }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Failed to change plan");
        return;
      }
      setChangeConfirmTier(null);
      // Refetch instead of nulling status — nulling forces the
      // skeleton and the panel gets stuck there until remount.
      await fetchStatus();
      window.dispatchEvent(new Event("securewarp-billing-refresh"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change plan");
    } finally {
      setChangingBusy(false);
    }
  }, [changeConfirmTier, changingBusy, fetchStatus]);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/subscription");
      if (res.ok) {
        const data = await res.json();
        if (data?.subscription) setDetail(data.subscription);
      }
    } catch { /* */ }
  }, []);

  const fetchInvoices = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/invoices");
      if (res.ok) {
        const data = await res.json();
        if (data?.invoices) setInvoices(data.invoices);
      }
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  useEffect(() => {
    if (status?.tier && status.tier !== "free") {
      fetchDetail();
      fetchInvoices();
    }
  }, [status?.tier, fetchDetail, fetchInvoices]);

  // Poll while a checkout is pending so the UI flips to Pro within
  // a second of Stripe firing the webhook rather than waiting for
  // the user to close + reopen the modal.
  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    pollTimerRef.current = setInterval(async () => {
      const res = await fetch("/api/billing/status");
      if (!res.ok) return;
      const data = await res.json();
      if (data?.tier && data.tier !== "free") {
        setStatus(data);
        setPendingTier(null);
        setClientSecret(null);
        setPendingSubId(null);
        // Let the sidebar (and anything else listening) re-read their
        // plan label from /api/billing/status. Dispatched once per
        // successful convergence, so no polling traffic leaks out.
        window.dispatchEvent(new Event("securewarp-billing-refresh"));
        if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
      }
    }, 2000);
  }, []);
  useEffect(() => () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
  }, []);

  // If the user navigates away (tab switch, modal close) with a
  // still-pending checkout, void the Stripe subscription on
  // unmount. Ref-captured so the cleanup reads the latest value
  // even if pendingSubId changes during the component's lifetime.
  const pendingSubIdRef = useRef<string | null>(null);
  useEffect(() => { pendingSubIdRef.current = pendingSubId; }, [pendingSubId]);
  useEffect(() => () => {
    const subId = pendingSubIdRef.current;
    if (subId) {
      // Fire-and-forget; we're unmounting so state updates are
      // irrelevant. keepalive ensures the request survives a tab
      // close or page navigation.
      fetch("/api/billing/checkout-abandon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: subId }),
        keepalive: true,
      }).catch(() => {});
    }
  }, []);

  const startCheckout = async (tier: "plus" | "pro") => {
    setError(null);

    // Already on a paid plan? Ask the user to confirm before
    // touching their payment method. /change-plan would otherwise
    // charge the prorated difference instantly with no warning —
    // correct mechanically, terrible UX.
    if (status?.tier && status.tier !== "free") {
      setChangeConfirmTier(tier);
      return;
    }

    setPendingTier(tier);
    setClientSecret(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (!res.ok || !data.clientSecret) {
        setError(data.error ?? "Failed to start checkout");
        setPendingTier(null);
        return;
      }
      setClientSecret(data.clientSecret);
      if (typeof data.subscriptionId === "string") {
        setPendingSubId(data.subscriptionId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
      setPendingTier(null);
    }
  };

  const options = useMemo(
    () => (clientSecret ? { clientSecret, appearance: { theme: "night" as const } } : undefined),
    [clientSecret],
  );

  // Don't render a placeholder Free card before /status responds —
  // showing "SecureWarp Free" and then flipping to "Plus" a beat
  // later reads like the upgrade got reverted. Skeleton instead.
  if (!status) {
    return (
      <div>
        <div className="p-4 rounded-[10px] bg-bg-overlay-tertiary mb-5 animate-pulse">
          <div className="h-[18px] w-[140px] rounded bg-bg-field mb-2" />
          <div className="h-[12px] w-[220px] rounded bg-bg-field mb-4" />
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="p-2.5 rounded-[8px] bg-bg-l2 border border-border-tertiary">
                <div className="h-[8px] w-[60px] rounded bg-bg-field mb-2" />
                <div className="h-[14px] w-[40px] rounded bg-bg-field mb-1" />
                <div className="h-[8px] w-[50px] rounded bg-bg-field" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const tier = status.tier;
  const isPaid = tier !== "free";
  const usage = status.usage;
  const limits = status.limits;
  const tiersList = status.tiers;
  const fmtLimit = (n: number | null) => (n === null ? "unlimited" : `${n}`);
  // Storage cap crosses the TB threshold at 1024 GB — shown as
  // "2.0 TB" instead of "2048 GB" / "2048.00 GB". TB tier keeps one
  // decimal consistently (2.0, 1.5); GB tier keeps two for fractional
  // usage values (0.47 GB) and drops decimals on whole-number caps.
  const formatStorageGB = (gb: number): string => {
    if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`;
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(2)} GB`;
  };
  const pct = (cur: number, cap: number | null) =>
    cap === null || cap === 0 ? 0 : Math.min((cur / cap) * 100, 100);

  return (
    <div>
      {/* Current plan card */}
      <div className="p-4 rounded-[10px] bg-bg-overlay-tertiary mb-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <p className="text-[14px] text-text-primary font-semibold">
              SecureWarp {limits.label}
            </p>
            {isPaid && detail && (() => {
              // Map Stripe's raw subscription status (+ the
              // cancel-at-period-end flag) onto a small colored pill
              // so states like "past_due" surface visually instead of
              // being buried one layer deeper. Keeps the user oriented
              // when a charge fails or a cancel is scheduled.
              const s = detail.status;
              // Append the relevant date to the pill — cancel deadline
              // if scheduled to end, renewal date otherwise. Keeps the
              // user oriented without the separate "Renews X" line.
              const periodDate = detail.currentPeriodEnd
                ? new Date(detail.currentPeriodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                : null;
              // Per-state label with date suffix. Each state gets the
              // contextual prefix that matches what the date means:
              // Renews for active, Ends for trial, Retries for failed
              // payment states.
              const withDate = (base: string, prefix: string) =>
                periodDate ? `${base} · ${prefix} ${periodDate}` : base;
              const { label, color, bg } = detail.cancelAtPeriodEnd
                ? { label: periodDate ? `Cancelling · ${periodDate}` : "Cancelling", color: "var(--accent-yellow-primary)", bg: "var(--accent-yellow-bg)" }
                : s === "active"
                  ? { label: withDate("Active", "Renews"), color: "var(--accent-green-primary)", bg: "color-mix(in srgb, var(--accent-green-primary) 10%, transparent)" }
                  : s === "trialing"
                    ? { label: withDate("Trial", "Ends"), color: "var(--accent-yellow-primary)", bg: "var(--accent-yellow-bg)" }
                    : s === "past_due"
                      ? { label: withDate("Past due", "Retries"), color: "var(--accent-red-primary)", bg: "color-mix(in srgb, var(--accent-red-primary) 10%, transparent)" }
                      : s === "unpaid"
                        ? { label: withDate("Unpaid", "Retries"), color: "var(--accent-red-primary)", bg: "color-mix(in srgb, var(--accent-red-primary) 10%, transparent)" }
                        : { label: periodDate ? `${s} · ${periodDate}` : s, color: "var(--text-disabled)", bg: "var(--bg-field)" };
              return (
                <span
                  className="inline-flex items-center gap-1.5 mt-1.5 px-1.5 h-[18px] rounded-full text-[10px] font-mono uppercase tracking-wider"
                  style={{ color, background: bg }}
                >
                  <span className="w-[6px] h-[6px] rounded-full" style={{ background: color }} />
                  {label}
                </span>
              );
            })()}
          </div>
          {/* Subscription management — inline on the right of the
              current-plan card so the card is self-contained (status +
              actions) and the panel body is purely tier comparison +
              invoices. Only renders on paid tiers and only when a
              checkout isn't in progress. */}
          {isPaid && detail && !pendingTier && (
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              {/* Action row: Update payment method | Cancel or Resume.
                  The `|` is a visual divider between two peer actions
                  rendered as text-buttons (no button borders) to keep
                  the header compact. Renewal date now lives in the
                  status pill on the left, so no redundant label here. */}
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  onClick={async () => {
                    if (openingPortal) return;
                    setOpeningPortal(true);
                    try {
                      const res = await fetch("/api/billing/portal", { method: "POST" });
                      const data = await res.json();
                      if (res.ok && data.url) { window.location.href = data.url; return; }
                    } finally { setOpeningPortal(false); }
                  }}
                  disabled={openingPortal}
                  className="font-medium text-text-secondary hover:text-text-primary transition-colors cursor-pointer disabled:opacity-50"
                >
                  {openingPortal ? "Opening…" : "Update payment method"}
                </button>
                <span className="text-text-disabled">|</span>
                {detail.cancelAtPeriodEnd ? (
                  <button
                    onClick={async () => {
                      setCancelBusy(true);
                      try {
                        const res = await fetch("/api/billing/cancel", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ cancelAtPeriodEnd: false }),
                        });
                        if (res.ok) { setDetail(null); setStatus(null); fetchStatus(); fetchDetail(); }
                      } finally { setCancelBusy(false); }
                    }}
                    disabled={cancelBusy}
                    className="font-medium text-text-secondary hover:text-text-primary transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {cancelBusy ? "…" : "Resume"}
                  </button>
                ) : (
                  <button
                    onClick={() => setCancelConfirm(true)}
                    className="font-medium text-accent-red hover:opacity-80 transition-opacity cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {status && (
          <div className="grid grid-cols-3 gap-3 mb-2">
            {[
              { label: "Storage", display: formatStorageGB(usage.storageGB), capDisplay: formatStorageGB(limits.storageGB), used: usage.storageGB, cap: limits.storageGB as number | null },
              { label: "Team seats", display: `${usage.seats}`, capDisplay: fmtLimit(limits.seats), used: usage.seats, cap: limits.seats },
              { label: "Workspaces", display: `${usage.workspaces}`, capDisplay: fmtLimit(limits.workspaces), used: usage.workspaces, cap: limits.workspaces },
            ].map((m) => {
              // Percent math runs on raw numeric used/cap — never on
              // the display string. Parsing "2 TB" would yield 2 and
              // break the bar when storage switches units.
              const usedPct = pct(m.used, m.cap);
              return (
                <div key={m.label} className="p-2.5 rounded-[8px] bg-bg-l2 border border-border-tertiary">
                  <p className="text-[10px] font-mono uppercase text-text-disabled tracking-wider">{m.label}</p>
                  <p className="text-[13px] text-text-primary font-medium mt-0.5">{m.display}</p>
                  <p className="text-[10px] text-text-disabled mt-0.5">of {m.capDisplay}</p>
                  {m.cap !== null && (
                    <div className="mt-1.5 h-[3px] rounded-full bg-bg-field overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${usedPct}%`,
                          background: usedPct > 90 ? "var(--accent-red-primary)" : "var(--accent-green-primary)",
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* All tiers visible inline. Each card has a context-aware CTA:
          - Current tier: disabled "Current plan" chip.
          - Higher tier than current: "Upgrade to <label>" → opens
            checkout (from free) or confirm-change (from paid).
          - Lower tier than current: "Downgrade to <label>" → opens
            cancel confirm (→ Free) or confirm-change (Pro → Plus).
          Hidden while the Stripe Elements checkout is expanded so the
          panel focuses on the active purchase flow. */}
      {!clientSecret && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          {tiersList.map((t) => {
            const isCurrent = t.id === tier;
            const rank = (x: Tier) => (x === "free" ? 0 : x === "plus" ? 1 : 2);
            const direction: "up" | "down" | "current" =
              isCurrent ? "current" : rank(t.id) > rank(tier) ? "up" : "down";
            const storageLabel = t.storageGB >= 1024 ? `${Math.round(t.storageGB / 1024)} TB` : `${t.storageGB} GB`;
            const handleClick = () => {
              if (isCurrent) return;
              // Free → paid: checkout. Plus ↔ Pro: confirm-change
              // (proration). Paid → Free: cancel-at-period-end confirm.
              if (t.id === "free") {
                setCancelConfirm(true);
              } else if (tier === "free") {
                void startCheckout(t.id as "plus" | "pro");
              } else {
                setChangeConfirmTier(t.id as "plus" | "pro");
              }
            };
            return (
              <div
                key={t.id}
                className={`rounded-[10px] border p-3 flex flex-col gap-2 transition-colors ${
                  isCurrent
                    ? "border-accent-green-primary bg-accent-green/5"
                    : "border-border-tertiary bg-bg-l2"
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] font-semibold text-text-primary">{t.label}</span>
                  <span className="text-[13px] text-text-primary font-mono">
                    ${(t.priceCents / 100).toFixed(2)}
                    <span className="text-[10px] text-text-disabled">/mo</span>
                  </span>
                </div>
                <ul className="flex flex-col gap-1 text-[11px] text-text-secondary min-h-[58px]">
                  <li>{storageLabel} storage</li>
                  <li>{t.seats === null ? "Unlimited seats" : `${t.seats} ${t.seats === 1 ? "user" : "seats"}`}</li>
                  <li>{t.workspaces === null ? "Unlimited workspaces" : `${t.workspaces} ${t.workspaces === 1 ? "workspace" : "workspaces"}`}</li>
                </ul>
                {isCurrent ? (
                  <div className="h-[32px] rounded-[8px] border border-accent-green/30 bg-accent-green/10 text-accent-green-primary text-[11px] font-medium flex items-center justify-center gap-1.5">
                    <HugeiconsIcon icon={Tick01Icon} size={12} />
                    Current plan
                  </div>
                ) : (
                  <button
                    onClick={handleClick}
                    className={`h-[32px] rounded-[8px] text-[11px] font-medium transition-colors cursor-pointer ${
                      direction === "up"
                        ? "bg-cta-primary text-text-inverse hover:opacity-90"
                        : "text-text-secondary border border-border-secondary hover:bg-bg-cell-hover"
                    }`}
                  >
                    {direction === "up" ? `Upgrade to ${t.label}` : `Downgrade to ${t.label}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Inline Stripe Elements checkout */}
      {pendingTier && clientSecret && options && (
        <div className="mb-5 rounded-[10px] border border-border-tertiary overflow-hidden animate-fade-in">
          <div className="px-4 py-3 border-b border-border-tertiary flex items-center justify-between">
            <p className="text-[13px] text-text-primary font-semibold">
              Upgrade to SecureWarp {pendingTier === "pro" ? "Pro" : "Plus"}
            </p>
            <button
              onClick={() => {
                // Void the incomplete subscription on abandon so
                // the Stripe dashboard doesn't fill up with
                // orphaned `incomplete` subs + open invoices.
                void abandonCheckout(pendingSubId);
                setPendingTier(null);
                setClientSecret(null);
                setPendingSubId(null);
              }}
              className="text-[11px] text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
          <div className="p-4">
            <Elements stripe={getStripe()} options={options}>
              <CheckoutForm
                tier={pendingTier}
                onSuccess={() => {
                  // Start polling for the webhook to land the
                  // subscription; the panel flips to Paid state
                  // automatically once status.tier is no longer free.
                  startPolling();
                }}
              />
            </Elements>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-5 p-3 rounded-[8px] border border-accent-red/40 bg-accent-red/10 text-[12px] text-accent-red">
          {error}
        </div>
      )}

      {/* Invoices */}
      {isPaid && invoices && invoices.length > 0 && (
        <div>
          <p className="text-[10px] font-mono uppercase text-text-disabled tracking-wider mb-2">Invoices</p>
          {/* Cap the invoice list at 4 rows worth of height and
              scroll within — keeps the plan card + subscription
              management + cancel button visible while the user
              browses their billing history. */}
          <div className="rounded-[10px] border border-border-tertiary overflow-hidden max-h-[180px] overflow-y-auto">
            {invoices.slice(0, 10).map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-border-tertiary last:border-b-0">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-text-primary">{new Date(inv.createdAt).toLocaleDateString()}</p>
                  <p className="text-[10px] text-text-disabled font-mono uppercase tracking-wider">
                    {inv.paid ? "Paid" : inv.status}
                  </p>
                </div>
                <span className="text-[12px] text-text-secondary font-mono">
                  ${(inv.totalAmountCents / 100).toFixed(2)} {inv.currency.toUpperCase()}
                </span>
                <button
                  onClick={async () => {
                    setInvoiceBusy(inv.id);
                    try {
                      const res = await fetch(`/api/billing/invoice/${inv.id}`);
                      const data = await res.json();
                      if (res.ok && data.url) window.open(data.url, "_blank", "noopener");
                    } finally { setInvoiceBusy(null); }
                  }}
                  disabled={invoiceBusy === inv.id}
                  className="h-[24px] px-2 rounded-[5px] text-[10px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50"
                >
                  {invoiceBusy === inv.id ? "…" : "PDF"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Change-plan confirm (paid → paid) */}
      {changeConfirmTier && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center"
          onClick={() => !changingBusy && setChangeConfirmTier(null)}
        >
          <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" />
          <div
            className="relative w-full max-w-[420px] mx-4 rounded-2xl bg-bg-l2 border border-border-primary overflow-hidden animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: "var(--shadow-l2)" }}
          >
            <div className="p-6">
              <p className="text-[15px] text-text-primary font-semibold mb-1">
                {changeConfirmTier === "pro" ? "Upgrade to Pro?" : "Switch to Plus?"}
              </p>
              <p className="text-[13px] text-text-secondary leading-relaxed">
                {changeConfirmTier === "pro"
                  ? "Takes effect immediately. Your card on file is charged for the prorated difference between your current plan and Pro."
                  : "Takes effect immediately. You'll receive a prorated credit for the unused portion of your current plan, applied to your next invoice."}
                {detail?.cancelAtPeriodEnd && (
                  <>
                    {" "}Your scheduled cancellation will also be removed so the subscription continues on the new tier.
                  </>
                )}
              </p>
            </div>
            <div className="px-6 pb-6 flex gap-3 justify-end">
              <button
                onClick={() => setChangeConfirmTier(null)}
                disabled={changingBusy}
                className="h-[36px] px-4 rounded-[8px] text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer disabled:opacity-50"
              >
                Keep current plan
              </button>
              <button
                onClick={confirmChangePlan}
                disabled={changingBusy}
                className="h-[36px] px-4 rounded-[8px] text-[12px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
              >
                {changingBusy ? "Switching…" : changeConfirmTier === "pro" ? "Upgrade to Pro" : "Switch to Plus"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel confirm */}
      {cancelConfirm && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center"
          onClick={() => setCancelConfirm(false)}
        >
          <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" />
          <div
            className="relative w-full max-w-[420px] mx-4 rounded-2xl bg-bg-l2 border border-border-primary overflow-hidden animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            style={{ boxShadow: "var(--shadow-l2)" }}
          >
            <div className="p-6">
              <p className="text-[15px] text-text-primary font-semibold mb-1">Cancel your subscription?</p>
              <p className="text-[13px] text-text-secondary leading-relaxed">
                {detail?.currentPeriodEnd
                  ? `You'll keep ${limits.label} access until ${new Date(detail.currentPeriodEnd).toLocaleDateString()}. Reverts to Free after that. You can resume any time before then.`
                  : `You'll keep ${limits.label} access until the end of the current billing period.`}
              </p>
            </div>
            <div className="px-6 pb-6 flex gap-3 justify-end">
              <button
                onClick={() => setCancelConfirm(false)}
                className="h-[36px] px-4 rounded-[8px] text-[12px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer"
              >
                Keep subscription
              </button>
              <button
                onClick={async () => {
                  setCancelBusy(true);
                  try {
                    const res = await fetch("/api/billing/cancel", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ cancelAtPeriodEnd: true }),
                    });
                    if (res.ok) { setCancelConfirm(false); fetchDetail(); }
                  } finally { setCancelBusy(false); }
                }}
                disabled={cancelBusy}
                className="h-[36px] px-4 rounded-[8px] text-[12px] font-medium text-text-inverse bg-accent-red hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
              >
                {cancelBusy ? "Canceling…" : "Cancel subscription"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckoutForm({
  tier,
  onSuccess,
}: {
  tier: "plus" | "pro";
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // PaymentElement is an async-mounted iframe. `useElements()` returns
  // a valid Elements instance before the iframe has fully rendered,
  // which is why gating only on `!!elements` wasn't enough — clicking
  // Subscribe early threw
  // "elements should have a mounted Payment Element" from
  // stripe.confirmPayment. `onReady` fires when the iframe is actually
  // interactive; we keep the button disabled until then.
  const [elementReady, setElementReady] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || !elementReady || busy) return;
    setBusy(true);
    setErr(null);

    const { error } = await stripe.confirmPayment({
      elements,
      // We stay on page — no redirect. If 3DS is required Stripe
      // opens it in a transient popup, completes on our origin.
      redirect: "if_required",
    });

    if (error) {
      setErr(error.message ?? "Payment failed");
      setBusy(false);
      return;
    }
    setDone(true);
    onSuccess();
  };

  if (done) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-[8px] bg-accent-green/10 border border-accent-green/30">
        <HugeiconsIcon icon={Tick01Icon} size={18} color="var(--accent-green-primary)" />
        <div>
          <p className="text-[13px] text-text-primary font-medium">Payment confirmed</p>
          <p className="text-[11px] text-text-disabled">Activating your {tier === "pro" ? "Pro" : "Plus"} plan…</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <PaymentElement onReady={() => setElementReady(true)} />
      {err && (
        <p className="text-[12px] text-accent-red">{err}</p>
      )}
      <button
        type="submit"
        disabled={!stripe || !elementReady || busy}
        className="h-[36px] rounded-[8px] text-[13px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? "Processing…" : !elementReady ? "Loading…" : `Subscribe to ${tier === "pro" ? "Pro" : "Plus"}`}
      </button>
      <p className="text-[10px] text-text-disabled text-center">
        Powered by Stripe. Cancel any time from this page.
      </p>
    </form>
  );
}
