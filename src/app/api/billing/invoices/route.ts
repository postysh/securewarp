import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { polar } from "@/lib/billing/polar";
import { logError } from "@/lib/log";

/**
 * List past invoices (Polar orders) for the caller. Filtered server-
 * side by Polar customer ID so a user can never see another user's
 * invoices. Returns only the fields the billing panel needs; the
 * invoice PDF URL is minted on-demand by /api/billing/invoice/[id]
 * so a short-lived URL doesn't rot in this list.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: row } = await supabase
      .from("billing_customers")
      .select("polar_customer_id")
      .eq("user_id", session.userId)
      .maybeSingle();
    if (!row?.polar_customer_id) return NextResponse.json({ invoices: [] });

    const resp = await polar().orders.list({
      customerId: row.polar_customer_id as string,
      limit: 50,
    });

    const items = resp.result?.items ?? [];
    const invoices = items.map((o) => ({
      id: o.id,
      createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
      status: o.status,
      paid: o.paid,
      totalAmountCents: o.totalAmount,
      currency: o.currency,
      billingReason: o.billingReason,
    }));
    return NextResponse.json({ invoices });
  } catch (err) {
    logError("billing.invoices", err);
    return NextResponse.json({ error: "Failed to load invoices" }, { status: 500 });
  }
}
