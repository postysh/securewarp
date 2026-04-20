import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, stripeCryptoProvider } from "@/lib/billing/stripe";
import { stripeConfig } from "@/lib/billing/config";
import { upsertSubscriptionRow } from "@/lib/billing/sync";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";
import { auditEvent } from "@/lib/audit";

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
    // SubtleCrypto provider required on Workers — the default
    // provider uses Node's crypto.timingSafeEqual which isn't
    // available there.
    event = await stripe().webhooks.constructEventAsync(
      body,
      signature,
      cfg.webhookSecret,
      undefined,
      stripeCryptoProvider(),
    );
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
        await upsertSubscriptionRow(event.data.object as Stripe.Subscription);
        // On a delete/cancel, flag any existing override as now
        // dormant for audit visibility. We don't delete the row — the
        // override can reactivate automatically if the user
        // resubscribes (see getEntitlements tier-gating). This
        // breadcrumb lets admins see "X's custom plan stopped
        // enforcing on date Y" in the audit stream.
        if (event.type === "customer.subscription.deleted") {
          try {
            const sub = event.data.object as Stripe.Subscription;
            const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
            const { data: bc } = await supabase
              .from("billing_customers")
              .select("user_id")
              .eq("stripe_customer_id", customerId)
              .maybeSingle();
            if (bc?.user_id) {
              const { data: ov } = await supabase
                .from("user_entitlement_overrides")
                .select("user_id")
                .eq("user_id", bc.user_id)
                .maybeSingle();
              if (ov) {
                auditEvent({
                  event: "billing.override.dormant",
                  actorUserId: null,
                  targetUserId: bc.user_id as string,
                  detail: `Stripe subscription ${sub.id} deleted; override now dormant until resubscribe`,
                });
              }
            }
          } catch (e) {
            logError("billing.webhook.override_audit", e);
          }
        }
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

