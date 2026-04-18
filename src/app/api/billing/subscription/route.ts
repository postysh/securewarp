import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getLatestSubscription } from "@/lib/billing/customers";
import { polar } from "@/lib/billing/polar";
import { logError } from "@/lib/log";

/**
 * Subscription detail for the caller's own billing panel.
 * Merges our stored row (fast) with Polar's authoritative state
 * (cancel-at-period-end, trial state, next invoice date) fetched
 * lazily. Returns 200 with `subscription: null` if the caller has
 * never subscribed — client distinguishes Free vs Pro from that.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const latest = await getLatestSubscription(session.userId);
    if (!latest) {
      return NextResponse.json({ subscription: null });
    }

    // Pull the full record from Polar for cancel_at_period_end etc.
    let cancelAtPeriodEnd = false;
    let currentPeriodEnd: string | null = latest.currentPeriodEnd;
    let currentPeriodStart: string | null = null;
    try {
      const sub = await polar().subscriptions.get({ id: latest.polarSubscriptionId });
      cancelAtPeriodEnd = sub.cancelAtPeriodEnd ?? false;
      currentPeriodEnd = sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : currentPeriodEnd;
      currentPeriodStart = sub.currentPeriodStart ? sub.currentPeriodStart.toISOString() : null;
    } catch (err) {
      // If Polar's API is unreachable we fall back to the DB snapshot
      // so the user still sees their plan; just without the
      // cancel-at-period-end flag. Safer than 500ing the whole panel.
      logError("billing.subscription.fetch", err);
    }

    return NextResponse.json({
      subscription: {
        id: latest.polarSubscriptionId,
        status: latest.status,
        productId: latest.productId,
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
