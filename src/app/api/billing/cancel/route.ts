import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getLatestSubscription } from "@/lib/billing/customers";
import { stripe } from "@/lib/billing/stripe";
import { logError } from "@/lib/log";

const CancelSchema = z.object({
  /** true = schedule cancel at period end; false = reverse a pending cancel */
  cancelAtPeriodEnd: z.boolean().default(true),
});

/**
 * Cancel (or un-cancel) the caller's active subscription. Defaults to
 * end-of-period cancel — user keeps Pro/Plus features until Stripe's
 * current_period_end, then reverts to Free. Stripe emits
 * `customer.subscription.updated` which our /webhook syncs to the DB.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const parsed = CancelSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const sub = await getLatestSubscription(session.userId);
    if (!sub) return NextResponse.json({ error: "No subscription" }, { status: 404 });

    await stripe().subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: parsed.data.cancelAtPeriodEnd,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("billing.cancel", err);
    return NextResponse.json({ error: "Failed to update subscription" }, { status: 500 });
  }
}
