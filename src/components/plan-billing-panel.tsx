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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingTier, setPendingTier] = useState<"plus" | "pro" | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
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

  const startCheckout = async (tier: "plus" | "pro") => {
    setError(null);
    setPendingTier(tier);
    setPickerOpen(false);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
      setPendingTier(null);
    }
  };

  const tier = status?.tier ?? "free";
  const isPaid = tier !== "free";
  const usage = status?.usage ?? { storageGB: 0, storageBytes: 0, seats: 1, workspaces: 0 };
  const limits = status?.limits ?? { storageGB: 20, seats: 1, workspaces: 1, priceCents: 0, label: "Free" };
  const tiersList = status?.tiers ?? [];
  const fmtLimit = (n: number | null) => (n === null ? "unlimited" : `${n}`);
  const pct = (cur: number, cap: number | null) =>
    cap === null || cap === 0 ? 0 : Math.min((cur / cap) * 100, 100);

  const options = useMemo(
    () => (clientSecret ? { clientSecret, appearance: { theme: "night" as const } } : undefined),
    [clientSecret],
  );

  return (
    <div>
      {/* Current plan card */}
      <div className="p-4 rounded-[10px] bg-bg-overlay-tertiary mb-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[14px] text-text-primary font-semibold">
              SecureWarp {limits.label}
            </p>
            <p className="text-[11px] text-text-disabled mt-0.5">
              {isPaid
                ? `$${(limits.priceCents / 100).toFixed(2)}/mo. ${limits.storageGB} GB storage, ${fmtLimit(limits.seats)} seats, ${fmtLimit(limits.workspaces)} workspaces.`
                : `${limits.storageGB} GB storage, ${fmtLimit(limits.seats)} user, ${fmtLimit(limits.workspaces)} workspace.`}
            </p>
          </div>
          {!clientSecret && (
            <button
              onClick={() => setPickerOpen((v) => !v)}
              className={`h-[28px] px-3 rounded-[6px] text-[11px] font-medium transition-colors cursor-pointer ${
                isPaid
                  ? "text-text-secondary hover:bg-bg-cell-hover border border-border-secondary"
                  : "text-text-inverse bg-cta-primary hover:opacity-90"
              }`}
            >
              {isPaid ? (tier === "pro" ? "Change plan" : "Upgrade to Pro") : "Upgrade"}
            </button>
          )}
        </div>

        {status && (
          <div className="grid grid-cols-3 gap-3 mb-2">
            {[
              { label: "Storage", value: `${usage.storageGB.toFixed(2)} GB`, cap: limits.storageGB as number | null, capDisplay: `${limits.storageGB} GB` },
              { label: "Team seats", value: `${usage.seats}`, cap: limits.seats, capDisplay: fmtLimit(limits.seats) },
              { label: "Workspaces", value: `${usage.workspaces}`, cap: limits.workspaces, capDisplay: fmtLimit(limits.workspaces) },
            ].map((m) => {
              const curNum = parseFloat(m.value);
              const used = pct(curNum, m.cap);
              return (
                <div key={m.label} className="p-2.5 rounded-[8px] bg-bg-l2 border border-border-tertiary">
                  <p className="text-[10px] font-mono uppercase text-text-disabled tracking-wider">{m.label}</p>
                  <p className="text-[13px] text-text-primary font-medium mt-0.5">{m.value}</p>
                  <p className="text-[10px] text-text-disabled mt-0.5">of {m.capDisplay}</p>
                  {m.cap !== null && (
                    <div className="mt-1.5 h-[3px] rounded-full bg-bg-field overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${used}%`,
                          background: used > 90 ? "var(--accent-red-primary)" : "var(--accent-green-primary)",
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

      {/* Tier picker (expanded in-place) */}
      {pickerOpen && !clientSecret && (
        <div className="mb-5 rounded-[10px] border border-border-tertiary overflow-hidden animate-fade-in">
          <div className="px-4 py-3 border-b border-border-tertiary">
            <p className="text-[13px] text-text-primary font-semibold">Choose a plan</p>
          </div>
          <div className="p-3 flex flex-col gap-2">
            {tiersList.filter((t) => t.id !== "free" && t.id !== tier).map((t) => (
              <button
                key={t.id}
                onClick={() => startCheckout(t.id as "plus" | "pro")}
                className="text-left rounded-[8px] border border-border-tertiary hover:border-accent-green-primary hover:bg-bg-cell-hover p-3 cursor-pointer transition-colors"
              >
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-[13px] font-semibold text-text-primary">
                    SecureWarp {t.label}
                  </span>
                  <span className="text-[13px] text-text-primary font-mono">
                    ${(t.priceCents / 100).toFixed(2)}
                    <span className="text-[10px] text-text-disabled">/mo</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-secondary">
                  <span>{t.storageGB >= 1024 ? `${Math.round(t.storageGB / 1024)} TB` : `${t.storageGB} GB`} storage</span>
                  <span>{t.seats === null ? "Unlimited" : t.seats} seats</span>
                  <span>{t.workspaces === null ? "Unlimited" : t.workspaces} workspaces</span>
                </div>
              </button>
            ))}
          </div>
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
              onClick={() => { setPendingTier(null); setClientSecret(null); }}
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

      {/* Subscription management (paid tier only) */}
      {isPaid && detail && !pendingTier && (
        <div className="p-3 rounded-[8px] bg-bg-l2 border border-border-tertiary mb-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] text-text-primary font-medium">
                {detail.cancelAtPeriodEnd ? "Cancellation scheduled" : "Active subscription"}
              </p>
              <p className="text-[11px] text-text-disabled mt-0.5">
                {detail.cancelAtPeriodEnd
                  ? `Ends ${detail.currentPeriodEnd ? new Date(detail.currentPeriodEnd).toLocaleDateString() : "at period end"}. You can keep using ${limits.label} until then.`
                  : `Next charge ${detail.currentPeriodEnd ? new Date(detail.currentPeriodEnd).toLocaleDateString() : "on renewal"}.`}
              </p>
            </div>
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
                className="h-[26px] px-2.5 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50"
              >
                {cancelBusy ? "…" : "Resume"}
              </button>
            ) : (
              <button
                onClick={() => setCancelConfirm(true)}
                className="h-[26px] px-2.5 rounded-[6px] text-[11px] font-medium text-accent-red hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer"
              >
                Cancel
              </button>
            )}
          </div>
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
            className="mt-3 text-[11px] text-text-tertiary hover:text-text-primary transition-colors cursor-pointer underline underline-offset-2 disabled:opacity-50"
          >
            {openingPortal ? "Opening…" : "Update payment method"}
          </button>
        </div>
      )}

      {/* Invoices */}
      {isPaid && invoices && invoices.length > 0 && (
        <div>
          <p className="text-[10px] font-mono uppercase text-text-disabled tracking-wider mb-2">Invoices</p>
          <div className="rounded-[10px] border border-border-tertiary overflow-hidden">
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
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
      <PaymentElement />
      {err && (
        <p className="text-[12px] text-accent-red">{err}</p>
      )}
      <button
        type="submit"
        disabled={!stripe || busy}
        className="h-[36px] rounded-[8px] text-[13px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? "Processing…" : `Subscribe to ${tier === "pro" ? "Pro" : "Plus"}`}
      </button>
      <p className="text-[10px] text-text-disabled text-center">
        Powered by Stripe. Cancel any time from this page.
      </p>
    </form>
  );
}
