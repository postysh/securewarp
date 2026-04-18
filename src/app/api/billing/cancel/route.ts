import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getLatestSubscription } from "@/lib/billing/customers";
import { polar } from "@/lib/billing/polar";
import { logError } from "@/lib/log";

const CancelSchema = z.object({
  // true  = schedule end-of-period cancellation (default, keeps access)
  // false = reverse a pending end-of-period cancellation
  cancelAtPeriodEnd: z.boolean().default(true),
  reason: z.enum([
    "too_expensive",
    "missing_features",
    "switched_service",
    "unused",
    "customer_service",
    "low_quality",
    "too_complex",
    "other",
  ]).optional(),
  comment: z.string().max(500).optional(),
});

/**
 * Cancel (or uncancel) the caller's active subscription. Defaults to
 * end-of-period — Polar keeps the subscription active until
 * currentPeriodEnd, then transitions it to revoked. The webhook
 * handler picks up the resulting subscription.updated event and
 * syncs our DB row.
 *
 * We do NOT expose immediate revoke here. If the user truly wants
 * to lose access immediately, they can use the hosted Polar portal
 * (manage link in the UI) — cheaper than building a separate flow
 * for a rare action.
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

    await polar().subscriptions.update({
      id: sub.polarSubscriptionId,
      subscriptionUpdate: {
        cancelAtPeriodEnd: parsed.data.cancelAtPeriodEnd,
        customerCancellationReason: parsed.data.reason,
        customerCancellationComment: parsed.data.comment,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("billing.cancel", err);
    return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });
  }
}
