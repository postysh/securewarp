import "server-only";
import type Stripe from "stripe";
import { supabase } from "@/lib/db/supabase";
import { stripe } from "./stripe";

/**
 * Upsert a subscription row from a Stripe Subscription object.
 * Shared between the webhook handler (push path) and on-demand sync
 * endpoints (pull path used by /status + /subscription so dev
 * environments without webhook forwarding still see Paid state).
 */
export async function upsertSubscriptionRow(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? "";
  const currentPeriodEnd = typeof item?.current_period_end === "number"
    ? new Date(item.current_period_end * 1000).toISOString()
    : null;

  const { data: bc } = await supabase
    .from("billing_customers")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (!bc?.user_id) return;

  await supabase
    .from("billing_subscriptions")
    .upsert(
      {
        user_id: bc.user_id,
        stripe_subscription_id: sub.id,
        status: sub.status,
        stripe_price_id: priceId,
        current_period_end: currentPeriodEnd,
        raw: sub as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" },
    );
}

/**
 * Pull the caller's most recent Stripe subscription and sync our
 * local row. Safety net for the dev case where webhooks can't reach
 * localhost, and a production reconciliation path if a webhook is
 * ever delayed or lost. No-op for customers without subscriptions.
 */
export async function syncLatestSubscriptionFor(userId: string): Promise<void> {
  const { data: row } = await supabase
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!row?.stripe_customer_id) return;

  // Pull the last several subscriptions — not just the most recent
  // created one. A user with an active plan who starts a new
  // checkout has at least two subscriptions in Stripe; we need both
  // rows in our DB so getLatestSubscription can pick the paid one.
  const list = await stripe().subscriptions.list({
    customer: row.stripe_customer_id as string,
    limit: 10,
    status: "all",
  });
  for (const sub of list.data) {
    await upsertSubscriptionRow(sub);
  }
}
