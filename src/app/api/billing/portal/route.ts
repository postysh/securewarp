import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { stripe } from "@/lib/billing/stripe";
import { logError } from "@/lib/log";

/**
 * Mint a short-lived Stripe Customer Portal URL. Only used from
 * "Update payment method" in the settings panel — the rest of the
 * portal actions (cancel, invoices) are handled by our own custom UI.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: row } = await supabase
      .from("billing_customers")
      .select("polar_customer_id")
      .eq("user_id", session.userId)
      .maybeSingle();
    if (!row?.polar_customer_id) {
      return NextResponse.json({ error: "No billing account" }, { status: 404 });
    }

    const origin = new URL(request.url).origin;
    const portal = await stripe().billingPortal.sessions.create({
      customer: row.polar_customer_id as string,
      return_url: `${origin}/drive`,
    });

    return NextResponse.json({ url: portal.url });
  } catch (err) {
    logError("billing.portal", err);
    return NextResponse.json({ error: "Failed to open portal" }, { status: 500 });
  }
}
