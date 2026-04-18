import "server-only";
import { supabase } from "@/lib/db/supabase";
import { tierFromPriceId, type Tier } from "./config";

/**
 * Vendor-neutral subscription lookups. Reads `billing_subscriptions`
 * rows written by the Stripe webhook handler. The column names
 * (`polar_subscription_id`, `product_id`) are historical from the
 * first billing attempt — they now hold Stripe subscription ids and
 * Stripe price ids respectively. A later migration renames them to
 * `external_subscription_id` / `stripe_price_id` for clarity.
 */

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
