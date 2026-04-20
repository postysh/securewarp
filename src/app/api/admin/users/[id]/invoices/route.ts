import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { stripe } from "@/lib/billing/stripe";
import { logError } from "@/lib/log";

/**
 * List Stripe invoices for one user. Mirrors /api/billing/invoices but
 * scoped by arbitrary user id and callable only by admins. Used from the
 * admin user detail page's Billing section to surface individual invoices
 * and their refundable payment intents.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: targetId } = await params;

    const { data: row } = await supabase
      .from("billing_customers")
      .select("stripe_customer_id")
      .eq("user_id", targetId)
      .maybeSingle();
    if (!row?.stripe_customer_id) return NextResponse.json({ invoices: [] });

    const list = await stripe().invoices.list({
      customer: row.stripe_customer_id as string,
      status: "paid",
      limit: 50,
      // Expand payment records (not payment_intent itself) — Stripe's
      // expand is capped at 4 nesting levels and list endpoints add a
      // `data.` prefix, so `.payment_intent` would be the 5th level
      // and 400s with `property_expansion_max_depth`. The underlying
      // `payment_intent` field comes back as a string id anyway, which
      // is all we need for the refund call.
      expand: ["data.payments.data.payment"],
    });

    const invoices = list.data.map((inv) => {
      // Pull the first payment_intent id off the invoice's payment
      // record — that's what Stripe's refund API wants. Fall back to
      // null if an invoice wasn't paid via a PaymentIntent (rare).
      const payments = (inv as unknown as {
        payments?: { data?: Array<{ payment?: { payment_intent?: string | { id?: string } } }> };
      }).payments?.data ?? [];
      const rawPi = payments[0]?.payment?.payment_intent;
      const paymentIntent = typeof rawPi === "string" ? rawPi : rawPi?.id ?? null;
      return {
        id: inv.id,
        number: inv.number,
        createdAt: new Date(inv.created * 1000).toISOString(),
        status: inv.status ?? "unknown",
        paid: inv.status === "paid",
        totalAmountCents: inv.total,
        currency: inv.currency,
        paymentIntent,
        hostedInvoiceUrl: inv.hosted_invoice_url,
      };
    });
    return NextResponse.json({ invoices });
  } catch (err) {
    logError("admin.users.invoices", err);
    return NextResponse.json({ error: "Failed to load invoices" }, { status: 500 });
  }
}
