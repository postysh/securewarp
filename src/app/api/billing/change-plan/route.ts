import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getLatestSubscription } from "@/lib/billing/customers";
import { stripe } from "@/lib/billing/stripe";
import { stripeConfig } from "@/lib/billing/config";
import { upsertSubscriptionRow } from "@/lib/billing/sync";
import { logError } from "@/lib/log";

const ChangeSchema = z.object({ tier: z.enum(["plus", "pro"]) });

/**
 * Switch an active subscription to a different tier. Used for
 * Pro → Plus (downgrade) and Plus → Pro (upgrade) without minting
 * a new subscription or routing the user through the Payment
 * Element again — the existing payment method on file handles the
 * prorated charge (or credit) Stripe generates.
 *
 * Proration behavior: `always_invoice` so the credit or charge
 * lands as an invoice line item immediately rather than rolling
 * into the next regular bill. Users expect their card to reflect
 * the change right away.
 *
 * Rejects users who don't already have an active subscription —
 * those should go through /checkout (fresh Payment Element flow).
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const parsed = ChangeSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const cfg = stripeConfig();
    const newPriceId = parsed.data.tier === "pro" ? cfg.priceIdPro : cfg.priceIdPlus;

    const current = await getLatestSubscription(session.userId);
    if (!current || (current.status !== "active" && current.status !== "trialing")) {
      return NextResponse.json(
        { error: "No active subscription — use /checkout instead", code: "no_active_sub" },
        { status: 400 },
      );
    }
    if (current.priceId === newPriceId) {
      return NextResponse.json({ error: "Already on this plan" }, { status: 400 });
    }

    // Pull the live subscription to get the item id we need to
    // replace. Expanding `items.data` isn't needed — items.data[0]
    // is always present on retrieve.
    const sub = await stripe().subscriptions.retrieve(current.stripeSubscriptionId);
    const itemId = sub.items.data[0]?.id;
    if (!itemId) {
      return NextResponse.json({ error: "Subscription missing an item" }, { status: 500 });
    }

    const updated = await stripe().subscriptions.update(current.stripeSubscriptionId, {
      items: [{ id: itemId, price: newPriceId }],
      proration_behavior: "always_invoice",
      metadata: { userId: session.userId, tier: parsed.data.tier },
    });

    await upsertSubscriptionRow(updated);

    return NextResponse.json({ ok: true, status: updated.status });
  } catch (err) {
    logError("billing.change-plan", err);
    return NextResponse.json({ error: "Failed to change plan" }, { status: 500 });
  }
}
