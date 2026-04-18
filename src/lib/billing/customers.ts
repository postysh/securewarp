import "server-only";
import { supabase } from "@/lib/db/supabase";
import { polar } from "./polar";
import { tierFromProductId, type Tier } from "./config";

/**
 * Billing-customer bridge. Maps a SecureWarp user to a Polar customer
 * record. First call for a user creates the Polar customer, then
 * inserts a row into `billing_customers`. Subsequent calls just
 * return the cached id.
 */
export async function getOrCreatePolarCustomer(
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

  // Create on Polar. `externalId` is our user_id so we can find the
  // customer again via Polar's API if the DB row ever desyncs.
  const created = await polar().customers.create({
    email,
    name: displayName ?? undefined,
    externalId: userId,
  });

  await supabase
    .from("billing_customers")
    .insert({ user_id: userId, polar_customer_id: created.id });

  return created.id;
}

export interface SubscriptionSummary {
  polarSubscriptionId: string;
  status: string;
  productId: string;
  currentPeriodEnd: string | null;
}

/**
 * Latest subscription row for a user (any status). Callers that need
 * "is the user currently paying?" should check status === "active"
 * or "trialing" and verify currentPeriodEnd has not passed.
 */
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
    polarSubscriptionId: data.polar_subscription_id as string,
    status: data.status as string,
    productId: data.product_id as string,
    currentPeriodEnd: (data.current_period_end as string | null) ?? null,
  };
}

/**
 * True if the user has a subscription the app should treat as paid:
 * status is active/trialing AND the current period hasn't ended yet
 * (grace handled by Polar before status flips to past_due).
 */
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
 * Resolve the caller's current tier. "free" when no active
 * subscription OR when the subscription's product id doesn't match
 * any known paid tier (covers archived legacy products gracefully).
 */
export async function getTier(userId: string): Promise<Tier> {
  const sub = await getLatestSubscription(userId);
  if (!sub) return "free";
  if (sub.status !== "active" && sub.status !== "trialing") return "free";
  if (sub.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() < Date.now()) {
    return "free";
  }
  return tierFromProductId(sub.productId) ?? "free";
}
