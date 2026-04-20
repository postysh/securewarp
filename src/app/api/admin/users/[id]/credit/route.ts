import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { stripe } from "@/lib/billing/stripe";
import { logError } from "@/lib/log";

/**
 * Issue a non-invoice-specific credit to a user's Stripe customer
 * balance. Unlike a refund, this does not return money to the card —
 * the credit sits on the customer record and automatically reduces the
 * next subscription invoice. Useful for goodwill gestures,
 * compensation for outages, or topping up an earlier refund.
 *
 * Negative amount on the balance transaction = credit to customer
 * (they owe less on the next invoice). Positive amount would be a
 * debit (they owe more); this endpoint only issues credits so we
 * always negate the caller's positive amount server-side.
 */
const BodySchema = z.object({
  amountCents: z.number().int().positive().max(100_000), // $1000 soft cap
  currency: z.string().length(3).default("usd"),
  reason: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: targetId } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const { data: row } = await supabase
      .from("billing_customers")
      .select("stripe_customer_id")
      .eq("user_id", targetId)
      .maybeSingle();
    if (!row?.stripe_customer_id) {
      return NextResponse.json({ error: "User has no billing account" }, { status: 404 });
    }

    const txn = await stripe().customers.createBalanceTransaction(
      row.stripe_customer_id as string,
      {
        amount: -parsed.data.amountCents,
        currency: parsed.data.currency.toLowerCase(),
        description: parsed.data.reason?.slice(0, 500) ?? "Goodwill credit",
        metadata: {
          securewarpUserId: targetId,
          securewarpActorUserId: ctx.userId,
        },
      },
    );

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "billing.credit",
      targetUserId: targetId,
      detail: JSON.stringify({
        amountCents: parsed.data.amountCents,
        currency: parsed.data.currency,
        txnId: txn.id,
        reason: parsed.data.reason ?? null,
      }),
    });

    return NextResponse.json({
      ok: true,
      txnId: txn.id,
      amountCents: -txn.amount, // flip back to positive for display
      endingBalanceCents: txn.ending_balance,
    });
  } catch (err) {
    logError("admin.users.credit", err);
    return NextResponse.json({ error: "Failed to issue credit" }, { status: 500 });
  }
}
