import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { stripe } from "@/lib/billing/stripe";
import { logError } from "@/lib/log";

/**
 * List the caller's past invoices from Stripe. Scoped by
 * customer id so another user's invoices can't leak through even if
 * their ids were known. Returns the lightweight fields the panel
 * renders; the hosted-invoice URL is looked up on click in
 * /api/billing/invoice/[id] rather than surfaced here.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: row } = await supabase
      .from("billing_customers")
      .select("stripe_customer_id")
      .eq("user_id", session.userId)
      .maybeSingle();
    if (!row?.stripe_customer_id) return NextResponse.json({ invoices: [] });

    // Only return invoices we'd want a customer to see — a paid
    // charge or line item that was actually billed. Filtering out:
    //   - `draft` (never sent)
    //   - `open` (finalized but unpaid; usually orphans from
    //     abandoned checkouts — our abandon endpoint voids these,
    //     but filter anyway as a backstop)
    //   - `void` (explicitly voided, includes abandoned checkouts)
    //   - `uncollectible` (rare, internal state)
    // Stripe throws `StripeInvalidRequestError` with statusCode 404
    // when the customer id no longer resolves (deleted, test/live
    // mismatch, etc). Treat that as "no invoices" rather than 500 —
    // the settings panel already copes with an empty list, and the
    // next checkout will re-mint a fresh customer via
    // getOrCreateStripeCustomer's guard. Any other Stripe error
    // (auth, network, rate limit) still surfaces as a 500 so we
    // don't silently swallow a real outage.
    let list;
    try {
      list = await stripe().invoices.list({
        customer: row.stripe_customer_id as string,
        status: "paid",
        limit: 50,
      });
    } catch (err) {
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 404) {
        logError("billing.invoices.stale_customer", { userId: session.userId });
        return NextResponse.json({ invoices: [] });
      }
      throw err;
    }

    const invoices = list.data.map((inv) => ({
      id: inv.id,
      number: inv.number,
      createdAt: new Date(inv.created * 1000).toISOString(),
      status: inv.status ?? "unknown",
      paid: inv.status === "paid",
      totalAmountCents: inv.total,
      currency: inv.currency,
    }));
    return NextResponse.json({ invoices });
  } catch (err) {
    logError("billing.invoices", err);
    return NextResponse.json({ error: "Failed to load invoices" }, { status: 500 });
  }
}
