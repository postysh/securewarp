import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { polar } from "@/lib/billing/polar";
import { polarConfig } from "@/lib/billing/config";
import { getOrCreatePolarCustomer } from "@/lib/billing/customers";
import { logError } from "@/lib/log";

const CheckoutSchema = z.object({
  tier: z.enum(["plus", "pro"]).default("plus"),
});

/**
 * Start a Polar checkout session for SecureWarp Pro. Returns a URL
 * the client redirects to. Pre-seeds the customer record so the
 * resulting subscription is bound to the caller's SecureWarp user_id
 * via Polar's externalId.
 *
 * The checkout's successUrl uses {CHECKOUT_ID} Polar template param
 * so we can land the user on /drive?checkout=... and show a
 * confirmation. The webhook is the source of truth for activation —
 * we don't flip entitlement on success_url alone (insecure).
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: user } = await supabase
      .from("users")
      .select("display_name")
      .eq("id", session.userId)
      .maybeSingle();
    const displayName = (user?.display_name as string | null) ?? null;

    // Best-effort parse — body is optional and defaults to plus.
    const rawBody = await request.json().catch(() => ({}));
    const parsed = CheckoutSchema.safeParse(rawBody);
    const tier = parsed.success ? parsed.data.tier : "plus";

    const customerId = await getOrCreatePolarCustomer(
      session.userId,
      session.email,
      displayName,
    );

    const cfg = polarConfig();
    const origin = new URL(request.url).origin;
    const productId = tier === "pro" ? cfg.productIdPro : cfg.productIdPlus;

    const checkout = await polar().checkouts.create({
      products: [productId],
      customerId,
      successUrl: `${origin}/drive?checkout={CHECKOUT_ID}`,
      // Required for the in-app embedded checkout iframe to
      // postMessage back to the parent. Must exactly match the
      // origin that will host the iframe.
      embedOrigin: origin,
      metadata: { userId: session.userId, tier },
    });

    return NextResponse.json({ url: checkout.url });
  } catch (err) {
    logError("billing.checkout", err);
    return NextResponse.json({ error: "Failed to start checkout" }, { status: 500 });
  }
}
