import "server-only";

/**
 * Tier definitions. Vendor-neutral — these limits drive in-app
 * enforcement (upload quota, workspace count, seat cap) and also
 * the UI's tier picker. Provider IDs (Stripe price ids, etc.) live
 * in stripeConfig() and are looked up separately.
 */

export type Tier = "free" | "plus" | "pro";

export interface TierLimits {
  label: string;
  priceCents: number;
  storageGB: number;
  /** Total users (owner + teammates). Infinity for unlimited. */
  seats: number;
  /** Owned workspaces. Infinity for unlimited. */
  workspaces: number;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    label: "Free",
    priceCents: 0,
    storageGB: 20,
    seats: 1,
    workspaces: 1,
  },
  plus: {
    label: "Plus",
    priceCents: 499,
    storageGB: 500,
    seats: 3,
    workspaces: Infinity,
  },
  pro: {
    label: "Pro",
    priceCents: 999,
    storageGB: 2048,
    seats: 10,
    workspaces: Infinity,
  },
};

export function limitsForTier(tier: Tier): TierLimits {
  return TIER_LIMITS[tier];
}

/**
 * Stripe configuration. Empty strings during the integration build-out
 * window (pre-keys). Callers that actually need Stripe should go
 * through `requireStripeConfig()` below so missing env fails loudly.
 */
export function stripeConfig() {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    priceIdPlus: process.env.STRIPE_PRICE_ID_PLUS ?? "",
    priceIdPro: process.env.STRIPE_PRICE_ID_PRO ?? "",
  };
}

export function requireStripeConfig() {
  const cfg = stripeConfig();
  // `publishableKey` is a NEXT_PUBLIC_* value baked into the
  // client bundle at build time. The server never needs it, and
  // requiring it here breaks any route that imports the config on
  // a Worker that doesn't also expose the var at runtime. Check
  // only the server-side secrets.
  const required: (keyof typeof cfg)[] = [
    "secretKey",
    "webhookSecret",
    "priceIdPlus",
    "priceIdPro",
  ];
  for (const name of required) {
    if (!cfg[name]) {
      const envName = `STRIPE_${String(name).replace(/([A-Z])/g, "_$1").toUpperCase()}`;
      throw new Error(
        `Stripe not configured: missing ${envName}. See README.md → Stripe billing.`,
      );
    }
  }
  return cfg;
}

/** Map a Stripe price id back to a tier. */
export function tierFromPriceId(priceId: string | null | undefined): Tier | null {
  if (!priceId) return null;
  const cfg = stripeConfig();
  if (priceId === cfg.priceIdPlus) return "plus";
  if (priceId === cfg.priceIdPro) return "pro";
  return null;
}
