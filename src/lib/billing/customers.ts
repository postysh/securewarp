import "server-only";
import { supabase } from "@/lib/db/supabase";
import { stripe } from "./stripe";
import { tierFromPriceId, type Tier } from "./config";

/**
 * Vendor-neutral subscription lookups. Reads `billing_subscriptions`
 * rows written by the Stripe webhook handler. The column names
 * (`polar_subscription_id`, `product_id`) are historical from the
 * first billing attempt — they now hold Stripe subscription ids and
 * Stripe price ids respectively. A later migration renames them to
 * `external_subscription_id` / `stripe_price_id` for clarity.
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
    .select("polar_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  // Stripe customer ids always start with `cus_`. Anything else is
  // a stale row from the Polar era (which used raw UUIDs). Don't
  // reuse it — create a fresh Stripe customer and upsert the row so
  // we overwrite the legacy value rather than error on insert.
  const stored = existing?.polar_customer_id as string | undefined;
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
      { user_id: userId, polar_customer_id: customer.id },
      { onConflict: "user_id" },
    );

  return customer.id;
}

export interface SubscriptionSummary {
  externalSubscriptionId: string;
  status: string;
  priceId: string; // product_id column repurposed for Stripe price id
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
    .select("polar_subscription_id, status, product_id, current_period_end")
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
    externalSubscriptionId: best.polar_subscription_id as string,
    status: best.status as string,
    priceId: best.product_id as string,
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

export async function getTier(userId: string): Promise<Tier> {
  const sub = await getLatestSubscription(userId);
  if (!sub) return "free";
  if (sub.status !== "active" && sub.status !== "trialing") return "free";
  if (sub.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() < Date.now()) {
    return "free";
  }
  return tierFromPriceId(sub.priceId) ?? "free";
}
