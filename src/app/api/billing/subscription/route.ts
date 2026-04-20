import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getLatestSubscription } from "@/lib/billing/customers";
import { stripe } from "@/lib/billing/stripe";
import { logError } from "@/lib/log";

/**
 * Subscription detail for the Plan & billing panel. Merges our local
 * billing_subscriptions snapshot with the live Stripe state so
 * cancel_at_period_end (set via the portal or our /cancel route)
 * shows up immediately without waiting for the next webhook.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const latest = await getLatestSubscription(session.userId);
    if (!latest) return NextResponse.json({ subscription: null });

    let cancelAtPeriodEnd = false;
    let currentPeriodEnd: string | null = latest.currentPeriodEnd;
    let currentPeriodStart: string | null = null;
    try {
      const sub = await stripe().subscriptions.retrieve(latest.stripeSubscriptionId);
      cancelAtPeriodEnd = sub.cancel_at_period_end;
      // current_period_{start,end} live on the subscription item in
      // newer Stripe API versions, not on the Subscription itself.
      // For single-item subscriptions (our Plus/Pro) we read from
      // items.data[0]; the mixed-item case doesn't apply to us.
      const item = sub.items.data[0];
      if (item) {
        if (typeof item.current_period_end === "number") {
          currentPeriodEnd = new Date(item.current_period_end * 1000).toISOString();
        }
        if (typeof item.current_period_start === "number") {
          currentPeriodStart = new Date(item.current_period_start * 1000).toISOString();
        }
      }
    } catch (err) {
      logError("billing.subscription.fetch", err);
    }

    return NextResponse.json({
      subscription: {
        id: latest.stripeSubscriptionId,
        status: latest.status,
        priceId: latest.priceId,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd,
      },
    });
  } catch (err) {
    logError("billing.subscription", err);
    return NextResponse.json({ error: "Failed to load subscription" }, { status: 500 });
  }
}
