import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { stripe } from "@/lib/billing/stripe";
import { logError } from "@/lib/log";

/**
 * Admin-initiated Stripe refund. Takes an invoice id (scoped to the
 * target user's Stripe customer), extracts the payment_intent, and
 * issues a full or partial refund via Stripe's Refunds API.
 *
 * Money-movement action — every call writes an admin_audit row
 * (actor + target + amount + reason) so a downstream request like
 * "who refunded customer X on date Y" has a single source of truth.
 */
const BodySchema = z.object({
  invoiceId: z.string().min(1),
  // Omit for a full refund. Partial amount must be > 0 and ≤ the
  // invoice total — Stripe rejects amounts larger than what's
  // available to refund.
  amountCents: z.number().int().positive().optional(),
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

    // Resolve the target user's Stripe customer id.
    const { data: row } = await supabase
      .from("billing_customers")
      .select("stripe_customer_id")
      .eq("user_id", targetId)
      .maybeSingle();
    if (!row?.stripe_customer_id) {
      return NextResponse.json({ error: "User has no billing account" }, { status: 404 });
    }

    // Pull the invoice, verify it belongs to this user, extract the
    // payment_intent to refund against.
    const invoice = await stripe().invoices.retrieve(parsed.data.invoiceId, {
      // Same 4-level expand ceiling as list; payment_intent comes back
      // as a string id on the payment record by default.
      expand: ["payments.data.payment"],
    });
    const invoiceCustomerId =
      typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    if (invoiceCustomerId !== row.stripe_customer_id) {
      // Don't leak ownership — treat as not found.
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (invoice.status !== "paid") {
      return NextResponse.json(
        { error: "Only paid invoices can be refunded" },
        { status: 400 },
      );
    }

    const payments = (invoice as unknown as {
      payments?: { data?: Array<{ payment?: { payment_intent?: string | { id?: string } } }> };
    }).payments?.data ?? [];
    const rawPi = payments[0]?.payment?.payment_intent;
    const paymentIntent = typeof rawPi === "string" ? rawPi : rawPi?.id;
    if (!paymentIntent) {
      return NextResponse.json(
        { error: "No refundable payment found on this invoice" },
        { status: 400 },
      );
    }

    const refund = await stripe().refunds.create({
      payment_intent: paymentIntent,
      amount: parsed.data.amountCents,
      reason: "requested_by_customer",
      metadata: {
        securewarpUserId: targetId,
        securewarpActorUserId: ctx.userId,
        invoiceId: parsed.data.invoiceId,
        supportReason: (parsed.data.reason ?? "").slice(0, 500),
      },
    });

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "billing.refund",
      targetUserId: targetId,
      detail: JSON.stringify({
        invoiceId: parsed.data.invoiceId,
        amountCents: parsed.data.amountCents ?? invoice.total,
        refundId: refund.id,
        reason: parsed.data.reason ?? null,
      }),
    });

    return NextResponse.json({
      ok: true,
      refundId: refund.id,
      amountCents: refund.amount,
      status: refund.status,
    });
  } catch (err) {
    logError("admin.users.refund", err);
    return NextResponse.json({ error: "Failed to issue refund" }, { status: 500 });
  }
}
