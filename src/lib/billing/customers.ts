import "server-only";
import { supabase } from "@/lib/db/supabase";
import { stripe } from "./stripe";
import { tierFromPriceId, TIER_LIMITS, type Tier } from "./config";

/**
 * Stripe customer + subscription lookups against our local DB mirror.
 */

/**
 * Get or create the Stripe customer mapped to this SecureWarp user.
 * First call creates the customer via Stripe's API and inserts a
 * billing_customers row; subsequent calls return the cached id.
 * `metadata.userId` on Stripe lets us find our user back from a
 * stray Stripe object (useful for webhook dedup).
 */
export async function getOrCreateStripeCustomer(
  userId: string,
  email: string,
  displayName: string | null,
): Promise<string> {
  const { data: existing } = await supabase
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  // Stripe customer ids always start with `cus_`. Anything else is
  // a stale row and shouldn't be reused — create a fresh Stripe
  // customer and upsert the row so we overwrite the bad value rather
  // than error on insert.
  const stored = existing?.stripe_customer_id as string | undefined;
  if (stored && stored.startsWith("cus_")) {
    // Also guard against customers that were deleted out-of-band
    // (e.g. via the Stripe dashboard). A deleted customer returns
    // `{ deleted: true }` on retrieve but still 404s on any write
    // path. Recreate so we never hand a zombie id to subscriptions.
    try {
      const c = await stripe().customers.retrieve(stored);
      if (!("deleted" in c) || c.deleted !== true) {
        return stored;
      }
    } catch {
      // If retrieve fails (auth issue, transient), fall through to
      // create a fresh one — better to have a throwaway new customer
      // than to block checkout.
    }
  }

  const customer = await stripe().customers.create({
    email,
    name: displayName ?? undefined,
    metadata: { userId },
  });

  await supabase
    .from("billing_customers")
    .upsert(
      { user_id: userId, stripe_customer_id: customer.id },
      { onConflict: "user_id" },
    );

  return customer.id;
}

export interface SubscriptionSummary {
  stripeSubscriptionId: string;
  status: string;
  priceId: string;
  currentPeriodEnd: string | null;
}

export async function getLatestSubscription(
  userId: string,
): Promise<SubscriptionSummary | null> {
  // A user can legitimately have multiple subscription rows: an
  // active paying one and an incomplete/canceled attempt from a
  // later aborted checkout. We want the one the user is actually
  // being charged for, so prefer active/trialing over everything
  // else. Within the same status class, newer wins.
  const { data } = await supabase
    .from("billing_subscriptions")
    .select("stripe_subscription_id, status, stripe_price_id, current_period_end")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (!data || data.length === 0) return null;

  const rank = (status: string): number => {
    if (status === "active") return 0;
    if (status === "trialing") return 1;
    if (status === "past_due") return 2;
    if (status === "paused") return 3;
    if (status === "incomplete" || status === "incomplete_expired") return 4;
    if (status === "canceled" || status === "unpaid") return 5;
    return 6;
  };
  const best = data.slice().sort((a, b) => rank(a.status as string) - rank(b.status as string))[0];
  return {
    stripeSubscriptionId: best.stripe_subscription_id as string,
    status: best.status as string,
    priceId: best.stripe_price_id as string,
    currentPeriodEnd: (best.current_period_end as string | null) ?? null,
  };
}

export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const sub = await getLatestSubscription(userId);
  if (!sub) return false;
  if (sub.status !== "active" && sub.status !== "trialing") return false;
  if (sub.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() < Date.now()) {
    return false;
  }
  return true;
}

/**
 * Effective limits + labels for a user, after layering per-user
 * overrides on top of their Stripe-assigned tier. Overrides live in
 * `user_entitlement_overrides` and are set by admins for custom deals
 * (enterprise quotes, goodwill storage bumps, bespoke seat counts,
 * etc.) — see README "Entitlement overrides" for the workflow.
 *
 * Precedence: override value → tier default. Only non-null override
 * columns win; everything else inherits the tier. That means you can
 * bump storage to 5 TB while seats/workspaces keep the Pro defaults.
 *
 * `isCustom` is true when ANY override column is non-null, so UI can
 * show a "Custom plan" chip or the override's label instead of the
 * stock tier name.
 *
 * Every entitlement check in the app (quota, seats, workspaces, the
 * status endpoint) must go through this function rather than reading
 * `TIER_LIMITS[tier]` directly, or overrides won't be enforced.
 */
export interface Entitlements {
  tier: Tier;
  tierLabel: string;
  priceCents: number;
  storageGB: number;
  seats: number;
  workspaces: number;
  maxFileSizeBytes: number;
  isCustom: boolean;
}

export async function getEntitlements(userId: string): Promise<Entitlements> {
  const tier = await getTier(userId);
  const base = TIER_LIMITS[tier];
  const { data: ov } = await supabase
    .from("user_entitlement_overrides")
    .select("tier_label_override, storage_gb_override, seats_override, workspaces_override, price_cents_override, max_file_size_bytes_override")
    .eq("user_id", userId)
    .maybeSingle();
  if (!ov) {
    return {
      tier,
      tierLabel: base.label,
      priceCents: base.priceCents,
      storageGB: base.storageGB,
      seats: base.seats,
      workspaces: base.workspaces,
      maxFileSizeBytes: base.maxFileSizeBytes,
      isCustom: false,
    };
  }
  // Tier-gated: the override only applies while the user is on a
  // paid Stripe tier. If they cancel down to Free, overrides go
  // dormant — Free defaults apply. The row stays in place so a
  // resubscribe auto-reactivates the override without admin
  // re-configuring it. Prevents the "canceled enterprise user keeps
  // 5 TB for free" drift scenario.
  if (tier === "free") {
    return {
      tier,
      tierLabel: base.label,
      priceCents: base.priceCents,
      storageGB: base.storageGB,
      seats: base.seats,
      workspaces: base.workspaces,
      maxFileSizeBytes: base.maxFileSizeBytes,
      isCustom: false,
    };
  }
  const hasAnyOverride =
    ov.tier_label_override !== null ||
    ov.storage_gb_override !== null ||
    ov.seats_override !== null ||
    ov.workspaces_override !== null ||
    ov.price_cents_override !== null ||
    ov.max_file_size_bytes_override !== null;
  return {
    tier,
    tierLabel: (ov.tier_label_override as string | null) ?? base.label,
    priceCents: (ov.price_cents_override as number | null) ?? base.priceCents,
    storageGB: (ov.storage_gb_override as number | null) ?? base.storageGB,
    seats: (ov.seats_override as number | null) ?? base.seats,
    workspaces: (ov.workspaces_override as number | null) ?? base.workspaces,
    maxFileSizeBytes: (ov.max_file_size_bytes_override as number | null) ?? base.maxFileSizeBytes,
    isCustom: hasAnyOverride,
  };
}

export async function getTier(userId: string): Promise<Tier> {
  const sub = await getLatestSubscription(userId);
  if (!sub) return "free";
  if (sub.status !== "active" && sub.status !== "trialing") return "free";
  if (sub.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() < Date.now()) {
    return "free";
  }
  return tierFromPriceId(sub.priceId) ?? "free";
}
