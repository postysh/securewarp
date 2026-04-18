import { NextResponse } from "next/server";
import { Webhook, WebhookVerificationError } from "standardwebhooks";
import { supabase } from "@/lib/db/supabase";
import { polarConfig } from "@/lib/billing/config";
import { logError } from "@/lib/log";

/**
 * Polar webhook handler. Signatures are Standard Webhooks format
 * (HMAC-SHA256 over `{id}.{timestamp}.{body}`, headers prefixed
 * `webhook-*`). The SDK's `validateWebhook` only validates payload
 * SHAPE, not authenticity — we verify the signature here with the
 * `standardwebhooks` library directly.
 *
 * Source-of-truth for subscription state flows through this endpoint:
 *   subscription.created / .active / .updated  → upsert row, status
 *   subscription.canceled / .revoked           → flip status
 *   subscription.past_due                      → flip status, keep row
 *
 * We keep the full raw Polar payload in `raw` jsonb so we can debug
 * unexpected state transitions without refetching.
 */
export async function POST(request: Request) {
  const { webhookSecret } = polarConfig();
  if (!webhookSecret) {
    // Misconfiguration is operator-visible — 500 so the webhook retry
    // on Polar's side surfaces the outage.
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  const body = await request.text();
  // Standard Webhooks expects lowercase header keys via the adapter's
  // Record<string,string>. Next.js Request.headers is a Headers
  // instance, case-insensitive on get() — normalize explicitly.
  const headers = {
    "webhook-id": request.headers.get("webhook-id") ?? "",
    "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": request.headers.get("webhook-signature") ?? "",
  };

  try {
    new Webhook(webhookSecret).verify(body, headers);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      logError("billing.webhook.verify", err);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    logError("billing.webhook.verify.other", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 400 });
  }

  let payload: {
    type: string;
    data: Record<string, unknown>;
  };
  try {
    payload = JSON.parse(body);
  } catch (err) {
    logError("billing.webhook.parse", err);
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  try {
    switch (payload.type) {
      case "subscription.created":
      case "subscription.active":
      case "subscription.updated":
      case "subscription.canceled":
      case "subscription.revoked":
      case "subscription.past_due":
      case "subscription.uncanceled":
        await upsertSubscription(payload.data);
        break;
      // Other event types (order.*, checkout.*, customer.*) are not
      // load-bearing for entitlement today. We ignore them to avoid
      // accidentally caching stale data before the subscription
      // events arrive. Add handlers here as needed.
      default:
        break;
    }
  } catch (err) {
    logError(`billing.webhook.${payload.type}`, err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

async function upsertSubscription(data: Record<string, unknown>): Promise<void> {
  const subscriptionId = data.id as string | undefined;
  const status = data.status as string | undefined;
  const productId = data.product_id as string | undefined;
  const currentPeriodEnd = (data.current_period_end as string | null) ?? null;
  const customerId = data.customer_id as string | undefined;

  if (!subscriptionId || !status || !productId || !customerId) return;

  // Map Polar customer → SecureWarp user via billing_customers.
  const { data: bc } = await supabase
    .from("billing_customers")
    .select("user_id")
    .eq("polar_customer_id", customerId)
    .maybeSingle();
  if (!bc?.user_id) return;

  await supabase.from("billing_subscriptions").upsert(
    {
      user_id: bc.user_id,
      polar_subscription_id: subscriptionId,
      status,
      product_id: productId,
      current_period_end: currentPeriodEnd,
      raw: data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "polar_subscription_id" },
  );
}
