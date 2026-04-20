import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { stripe } from "@/lib/billing/stripe";
import { logError } from "@/lib/log";

/**
 * Return the hosted invoice URL for one invoice. Verifies the
 * caller owns the Stripe customer behind the invoice before
 * revealing the URL — a logged-in user must not be able to crawl
 * invoice ids belonging to other customers in the same Stripe
 * account.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ invoiceId: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { invoiceId } = await ctx.params;

    const { data: customer } = await supabase
      .from("billing_customers")
      .select("stripe_customer_id")
      .eq("user_id", session.userId)
      .maybeSingle();
    if (!customer?.stripe_customer_id) {
      return NextResponse.json({ error: "No billing account" }, { status: 404 });
    }

    const invoice = await stripe().invoices.retrieve(invoiceId);
    const invoiceCustomerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    if (invoiceCustomerId !== customer.stripe_customer_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      url: invoice.hosted_invoice_url,
      pdf: invoice.invoice_pdf,
    });
  } catch (err) {
    logError("billing.invoice", err);
    return NextResponse.json({ error: "Failed to open invoice" }, { status: 500 });
  }
}
