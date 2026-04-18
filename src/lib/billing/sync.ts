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
    .eq("polar_customer_id", customerId)
    .maybeSingle();
  if (!bc?.user_id) return;

  await supabase
    .from("billing_subscriptions")
    .upsert(
      {
        user_id: bc.user_id,
        polar_subscription_id: sub.id,
        status: sub.status,
        product_id: priceId,
        current_period_end: currentPeriodEnd,
        raw: sub as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "polar_subscription_id" },
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
    .select("polar_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!row?.polar_customer_id) return;

  const list = await stripe().subscriptions.list({
    customer: row.polar_customer_id as string,
    limit: 1,
    status: "all",
  });
  const latest = list.data[0];
  if (!latest) return;
  await upsertSubscriptionRow(latest);
}
