import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { stripe } from "@/lib/billing/stripe";
import { logError } from "@/lib/log";

const AbandonSchema = z.object({
  subscriptionId: z.string().min(1),
});

/**
 * Clean up an abandoned checkout. Stripe's default_incomplete
 * subscription path finalizes a real invoice on creation, so an
 * aborted checkout leaves behind an "open" invoice + an
 * `incomplete` subscription in the dashboard. Called from the
 * client when the user cancels the Payment Element or closes the
 * tier picker before confirming payment.
 *
 * We verify the subscription belongs to the caller's Stripe
 * customer before deleting anything — otherwise a logged-in user
 * could nuke another customer's subscription id by guessing.
 * We only cancel subscriptions still in `incomplete` state; active
 * subs aren't touched even if the caller asks.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const parsed = AbandonSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const { data: customer } = await supabase
      .from("billing_customers")
      .select("stripe_customer_id")
      .eq("user_id", session.userId)
      .maybeSingle();
    if (!customer?.stripe_customer_id) {
      return NextResponse.json({ ok: true }); // nothing to clean up
    }

    // Verify ownership + status.
    const sub = await stripe().subscriptions.retrieve(parsed.data.subscriptionId);
    const subCustomerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    if (subCustomerId !== customer.stripe_customer_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (sub.status !== "incomplete") {
      return NextResponse.json({ ok: true, skipped: "not incomplete" });
    }

    // Void the associated open invoice so it doesn't show up in
    // the customer's Stripe invoices list as an orphan. Canceling
    // the subscription alone leaves the open invoice around.
    const invoiceId = typeof sub.latest_invoice === "string"
      ? sub.latest_invoice
      : sub.latest_invoice?.id;
    if (invoiceId) {
      try { await stripe().invoices.voidInvoice(invoiceId); }
      catch (e) { logError("billing.abandon.void", e); }
    }
    // Cancel (permanently) the incomplete subscription.
    try { await stripe().subscriptions.cancel(sub.id); }
    catch (e) { logError("billing.abandon.cancel", e); }

    // Drop the row so our own Plan panel doesn't see a ghost.
    await supabase
      .from("billing_subscriptions")
      .delete()
      .eq("stripe_subscription_id", sub.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("billing.abandon", err);
    return NextResponse.json({ error: "Failed to abandon" }, { status: 500 });
  }
}
