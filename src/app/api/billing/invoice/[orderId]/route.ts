import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { polar } from "@/lib/billing/polar";
import { logError } from "@/lib/log";

/**
 * Mint a short-lived URL for a specific invoice PDF. We verify the
 * order belongs to the caller's Polar customer before handing the
 * URL out, otherwise a valid user could crawl invoice IDs belonging
 * to other customers in the same org.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ orderId: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { orderId } = await ctx.params;

    const { data: customer } = await supabase
      .from("billing_customers")
      .select("polar_customer_id")
      .eq("user_id", session.userId)
      .maybeSingle();
    if (!customer?.polar_customer_id) {
      return NextResponse.json({ error: "No billing account" }, { status: 404 });
    }

    // Verify ownership — the `orders.get` response includes
    // customer_id; we reject anything that doesn't match.
    const order = await polar().orders.get({ id: orderId });
    if (order.customerId !== customer.polar_customer_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const invoice = await polar().orders.invoice({ id: orderId });
    return NextResponse.json({ url: invoice.url });
  } catch (err) {
    logError("billing.invoice", err);
    return NextResponse.json({ error: "Failed to open invoice" }, { status: 500 });
  }
}
