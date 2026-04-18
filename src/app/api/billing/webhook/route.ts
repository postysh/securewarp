import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { supabase } from "@/lib/db/supabase";
import { stripe } from "@/lib/billing/stripe";
import { stripeConfig } from "@/lib/billing/config";
import { logError } from "@/lib/log";

/**
 * Stripe webhook. HMAC-SHA256 signature verification via
 * `constructEvent`, which also rejects replay attempts outside a
 * 5-minute tolerance window. Events beyond the subscription
 * lifecycle are ignored — add handlers only when the app actually
 * needs to react to them.
 *
 * Raw body is critical: Stripe signs the exact bytes of the
 * request body. We use `request.text()` rather than `.json()` so
 * whitespace/encoding preserved for the signature check.
 */
export async function POST(request: Request) {
  const cfg = stripeConfig();
  if (!cfg.webhookSecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature") ?? "";
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(body, signature, cfg.webhookSecret);
  } catch (err) {
    logError("billing.webhook.verify", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        await upsertSubscription(event.data.object as Stripe.Subscription);
        break;
      default:
        // checkout.session.completed and invoice.paid are useful
        // signals for future features (welcome emails, receipt
        // tracking). They don't change app state today.
        break;
    }
  } catch (err) {
    logError(`billing.webhook.${event.type}`, err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function upsertSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? "";
  // current_period_end moved onto SubscriptionItem in newer API
  // versions; we only ever have one item per subscription so
  // reading items.data[0] is equivalent to the old top-level field.
  const currentPeriodEnd = typeof item?.current_period_end === "number"
    ? new Date(item.current_period_end * 1000).toISOString()
    : null;

  const { data: bc } = await supabase
    .from("billing_customers")
    .select("user_id")
    .eq("polar_customer_id", customerId)
    .maybeSingle();
  if (!bc?.user_id) return; // customer predates us; skip

  await supabase
    .from("billing_subscriptions")
    .upsert(
      {
        user_id: bc.user_id,
        polar_subscription_id: sub.id,
        status: sub.status,
        product_id: priceId, // column legacy name; holds Stripe price id now
        current_period_end: currentPeriodEnd,
        raw: sub as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "polar_subscription_id" },
    );
}
