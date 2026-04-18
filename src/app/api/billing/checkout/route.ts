import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { stripe } from "@/lib/billing/stripe";
import { stripeConfig } from "@/lib/billing/config";
import { getOrCreateStripeCustomer } from "@/lib/billing/customers";
import { logError } from "@/lib/log";

const CheckoutSchema = z.object({ tier: z.enum(["plus", "pro"]).default("plus") });

/**
 * Create (or intent-to-create) a subscription for the caller using
 * Stripe Elements in "incomplete" mode. Returns a PaymentIntent
 * client_secret the frontend mounts into a Payment Element, so
 * checkout happens in-page with no redirect.
 *
 * How it works:
 *   1. Get-or-create the Stripe customer for this SecureWarp user.
 *   2. Create a subscription with `payment_behavior: default_incomplete`
 *      and expand the latest invoice's payment_intent — Stripe returns
 *      a subscription in `incomplete` state plus a PaymentIntent whose
 *      client_secret is our handle for the Elements flow.
 *   3. The Element confirms on the client with that secret. On
 *      success Stripe emits the `invoice.paid` + `customer.subscription.*`
 *      webhooks which our /webhook endpoint turns into database rows.
 *
 * The `customer.subscription.created` webhook IS fired even before
 * payment succeeds (subscription is in `incomplete` status). Our
 * webhook handler's upsert ignores that state; only `active` /
 * `trialing` flips the app into paid mode via getTier.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rawBody = await request.json().catch(() => ({}));
    const parsed = CheckoutSchema.safeParse(rawBody);
    const tier = parsed.success ? parsed.data.tier : "plus";

    const { data: user } = await supabase
      .from("users")
      .select("display_name")
      .eq("id", session.userId)
      .maybeSingle();
    const displayName = (user?.display_name as string | null) ?? null;

    const customerId = await getOrCreateStripeCustomer(session.userId, session.email, displayName);

    const cfg = stripeConfig();
    const priceId = tier === "pro" ? cfg.priceIdPro : cfg.priceIdPlus;

    const subscription = await stripe().subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
      },
      expand: ["latest_invoice.payment_intent"],
      metadata: { userId: session.userId, tier },
    });

    const latestInvoice = subscription.latest_invoice;
    let clientSecret: string | null = null;
    if (latestInvoice && typeof latestInvoice !== "string") {
      const pi = (latestInvoice as { payment_intent?: { client_secret?: string } }).payment_intent;
      clientSecret = pi?.client_secret ?? null;
    }
    if (!clientSecret) {
      return NextResponse.json(
        { error: "Stripe didn't return a client_secret for the checkout" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      subscriptionId: subscription.id,
      clientSecret,
      customerId,
    });
  } catch (err) {
    logError("billing.checkout", err);
    return NextResponse.json({ error: "Failed to start checkout" }, { status: 500 });
  }
}
