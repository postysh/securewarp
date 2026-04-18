import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { polar } from "@/lib/billing/polar";
import { getLatestSubscription } from "@/lib/billing/customers";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Mint a short-lived customer portal URL so the user can manage
 * their subscription (payment method, cancel, view invoices).
 * Requires an existing billing_customer row — 404 if they've never
 * interacted with billing.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: row } = await supabase
      .from("billing_customers")
      .select("polar_customer_id")
      .eq("user_id", session.userId)
      .maybeSingle();
    if (!row?.polar_customer_id) {
      return NextResponse.json({ error: "No billing account" }, { status: 404 });
    }

    // Silence unused warning — getLatestSubscription is reserved for
    // future entitlement gating on the portal endpoint.
    void getLatestSubscription;

    const origin = new URL(request.url).origin;
    const sess = await polar().customerSessions.create({
      customerId: row.polar_customer_id as string,
      returnUrl: `${origin}/drive`,
    });

    return NextResponse.json({ url: sess.customerPortalUrl });
  } catch (err) {
    logError("billing.portal", err);
    return NextResponse.json({ error: "Failed to open portal" }, { status: 500 });
  }
}
