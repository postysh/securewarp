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
  if (existing?.polar_customer_id) {
    return existing.polar_customer_id as string;
  }

  const customer = await stripe().customers.create({
    email,
    name: displayName ?? undefined,
    metadata: { userId },
  });

  await supabase
    .from("billing_customers")
    .insert({ user_id: userId, polar_customer_id: customer.id });

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
  const { data } = await supabase
    .from("billing_subscriptions")
    .select("polar_subscription_id, status, product_id, current_period_end")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    externalSubscriptionId: data.polar_subscription_id as string,
    status: data.status as string,
    priceId: data.product_id as string,
    currentPeriodEnd: (data.current_period_end as string | null) ?? null,
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
