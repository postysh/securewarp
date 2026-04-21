import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, stripeCryptoProvider } from "@/lib/billing/stripe";
import { stripeConfig, tierFromPriceId, TIER_LIMITS } from "@/lib/billing/config";
import { upsertSubscriptionRow } from "@/lib/billing/sync";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";
import { auditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/email/send";

/**
 * Stripe webhook. HMAC-SHA256 signature verification via
 * `constructEvent`, which also rejects replay attempts outside a
 * 5-minute tolerance window. Events beyond the subscription
 * lifecycle are ignored — add handlers only when the app actually
 * needs to react to them.
 *
 * Raw body is critical: Stripe signs the exact bytes of the
 * request body. We use `request.text()` rather than `.json()` so
 * whitespace/encoding preserved for the signature check.
 */
export async function POST(request: Request) {
  const cfg = stripeConfig();
  if (!cfg.webhookSecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature") ?? "";
  const body = await request.text();

  let event: Stripe.Event;
  try {
    // SubtleCrypto provider required on Workers — the default
    // provider uses Node's crypto.timingSafeEqual which isn't
    // available there.
    event = await stripe().webhooks.constructEventAsync(
      body,
      signature,
      cfg.webhookSecret,
      undefined,
      stripeCryptoProvider(),
    );
  } catch (err) {
    logError("billing.webhook.verify", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        await upsertSubscriptionRow(event.data.object as Stripe.Subscription);
        // On a delete/cancel, flag any existing override as now
        // dormant for audit visibility. We don't delete the row — the
        // override can reactivate automatically if the user
        // resubscribes (see getEntitlements tier-gating). This
        // breadcrumb lets admins see "X's custom plan stopped
        // enforcing on date Y" in the audit stream.
        if (event.type === "customer.subscription.deleted") {
          try {
            const sub = event.data.object as Stripe.Subscription;
            const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
            const { data: bc } = await supabase
              .from("billing_customers")
              .select("user_id")
              .eq("stripe_customer_id", customerId)
              .maybeSingle();
            if (bc?.user_id) {
              const { data: ov } = await supabase
                .from("user_entitlement_overrides")
                .select("user_id")
                .eq("user_id", bc.user_id)
                .maybeSingle();
              if (ov) {
                auditEvent({
                  event: "billing.override.dormant",
                  actorUserId: null,
                  targetUserId: bc.user_id as string,
                  detail: `Stripe subscription ${sub.id} deleted; override now dormant until resubscribe`,
                });
              }
            }
          } catch (e) {
            logError("billing.webhook.override_audit", e);
          }
        }
        break;
      case "invoice.paid": {
        const inv = event.data.object as Stripe.Invoice;
        const origin = new URL(request.url).origin;
        await handleInvoicePaid(inv, origin);
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const origin = new URL(request.url).origin;
        await handleInvoicePaymentFailed(inv, origin);
        break;
      }
      case "invoice.upcoming": {
        // Stripe fires this N days before the invoice finalizes. N is
        // configured on the endpoint (Stripe dashboard → Webhooks →
        // endpoint → "Events" → invoice.upcoming → "Notify N days
        // before"). Default is 3 days; adjust there if you want a
        // different lead time.
        const inv = event.data.object as Stripe.Invoice;
        const origin = new URL(request.url).origin;
        await handleInvoiceUpcoming(inv, origin);
        break;
      }
      default:
        // Other events (checkout.session.completed etc.) don't change
        // app state today. Add handlers here when a new feature needs
        // them.
        break;
    }
  } catch (err) {
    logError(`billing.webhook.${event.type}`, err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/* ─── Helpers ────────────────────────────────────────────────── */

/**
 * Resolve a Stripe invoice to the SecureWarp user it belongs to.
 * Returns the user's email, display_name, and notification_prefs
 * plus the plan tier label derived from the invoice's line-item
 * price id. Returns null if we can't find the user — which means
 * an orphan customer (created out-of-band via the Stripe dashboard
 * or from a different environment).
 */
async function resolveInvoiceRecipient(invoice: Stripe.Invoice): Promise<{
  userId: string;
  email: string;
  displayName: string | null;
  prefs: Record<string, boolean>;
  planLabel: string;
} | null> {
  const customerId = typeof invoice.customer === "string"
    ? invoice.customer
    : invoice.customer?.id ?? null;
  if (!customerId) return null;

  const { data: bc } = await supabase
    .from("billing_customers")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (!bc?.user_id) return null;

  const { data: user } = await supabase
    .from("users")
    .select("email, display_name, notification_prefs")
    .eq("id", bc.user_id as string)
    .maybeSingle();
  if (!user?.email) return null;

  // Plan label is derived from the line item's price id. The SDK's
  // `price` field can be a Price object or a string depending on
  // expand state — normalize to the id. Fall back to "SecureWarp"
  // if we can't map (customer on a legacy price, for example) —
  // the email still makes sense with a generic label.
  const priceRef = invoice.lines?.data?.[0]?.pricing?.price_details?.price
    ?? null;
  const priceId = typeof priceRef === "string"
    ? priceRef
    : priceRef && typeof priceRef === "object" && "id" in priceRef
      ? (priceRef as { id: string }).id
      : null;
  const tier = tierFromPriceId(priceId);
  const planLabel = tier ? TIER_LIMITS[tier].label : "SecureWarp";

  return {
    userId: bc.user_id as string,
    email: user.email as string,
    displayName: (user.display_name as string | null) ?? null,
    prefs: (user.notification_prefs as Record<string, boolean>) ?? {},
    planLabel,
  };
}

function formatInvoiceAmount(invoice: Stripe.Invoice): string {
  const cents = invoice.amount_due ?? invoice.amount_paid ?? 0;
  const currency = (invoice.currency ?? "usd").toUpperCase();
  const dollars = cents / 100;
  // Intl.NumberFormat with currency style gets us $4.99 / €4.99 /
  // etc. with correct locale-specific symbols. Fall back to a plain
  // string if the currency code is unrecognized.
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(dollars);
  } catch {
    return `${dollars.toFixed(2)} ${currency}`;
  }
}

function formatUnixDate(ts: number | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

async function handleInvoicePaid(invoice: Stripe.Invoice, origin: string) {
  const r = await resolveInvoiceRecipient(invoice);
  if (!r) return;
  if (r.prefs.billing_receipts === false) return;

  // `period_end` is the end of this paid billing cycle, which is the
  // start of the next cycle = the next renewal date for subscriptions.
  const nextRenewal = formatUnixDate(invoice.lines?.data?.[0]?.period?.end ?? null);

  try {
    await sendEmail({
      to: r.email,
      template: "billing-receipt",
      data: {
        displayName: r.displayName,
        planLabel: r.planLabel,
        amountFormatted: formatInvoiceAmount(invoice),
        invoicePdfUrl: invoice.invoice_pdf ?? null,
        nextRenewalDate: nextRenewal,
        portalUrl: `${origin}/drive`,
      },
    });
  } catch (err) {
    logError("billing.webhook.invoice_paid.email", err);
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice, origin: string) {
  const r = await resolveInvoiceRecipient(invoice);
  if (!r) return;
  // Deliberately NOT gated on notification_prefs — see the template
  // comment. A silent failed charge would downgrade the user with no
  // warning, which is worse than a duplicate email.

  const retryDate = formatUnixDate(invoice.next_payment_attempt ?? null);

  try {
    await sendEmail({
      to: r.email,
      template: "billing-payment-failed",
      data: {
        displayName: r.displayName,
        planLabel: r.planLabel,
        amountFormatted: formatInvoiceAmount(invoice),
        portalUrl: `${origin}/drive`,
        retryDate,
      },
    });
  } catch (err) {
    logError("billing.webhook.invoice_payment_failed.email", err);
  }
}

async function handleInvoiceUpcoming(invoice: Stripe.Invoice, origin: string) {
  const r = await resolveInvoiceRecipient(invoice);
  if (!r) return;
  if (r.prefs.billing_renewal_reminder === false) return;

  // Upcoming invoices fire with a future `period_end` representing
  // the end of the NEXT cycle; the renewal date (when the charge
  // lands) is the current `period_start` / the invoice's
  // `next_payment_attempt`, or equivalently the current period_end
  // of the active subscription. Use next_payment_attempt first,
  // falling back to period_end of the first line, for robustness.
  const renewalDate = formatUnixDate(
    invoice.next_payment_attempt
      ?? invoice.lines?.data?.[0]?.period?.start
      ?? null,
  );
  if (!renewalDate) return;

  try {
    await sendEmail({
      to: r.email,
      template: "billing-renewal-reminder",
      data: {
        displayName: r.displayName,
        planLabel: r.planLabel,
        amountFormatted: formatInvoiceAmount(invoice),
        renewalDate,
        portalUrl: `${origin}/drive`,
      },
    });
  } catch (err) {
    logError("billing.webhook.invoice_upcoming.email", err);
  }
}

