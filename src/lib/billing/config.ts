import "server-only";

/**
 * Polar.sh billing configuration. Tier-based pricing: Free, Plus,
 * Pro. Each paid tier is a fixed-price monthly subscription with
 * well-defined limits enforced in-app. No usage metering — we moved
 * away from that because consumers overwhelmingly expect tiers
 * (Proton, Filen, Dropbox, iCloud, Google One all do this).
 *
 * Changing a tier's limits affects every subscriber on that tier
 * immediately. Coordinate with landing-page copy when adjusting.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required billing env var: ${name}. ` +
        "See README.md → Polar.sh billing section.",
    );
  }
  return value;
}

export type Tier = "free" | "plus" | "pro";

export interface TierLimits {
  /** Human-readable label used in UI copy. */
  label: string;
  /** Monthly price in USD cents, 0 for free. */
  priceCents: number;
  /** Hard storage cap in GB. */
  storageGB: number;
  /** Total user count including the owner. `Infinity` for unlimited. */
  seats: number;
  /** Total workspaces owned. `Infinity` for unlimited. */
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
    storageGB: 2048, // 2 TB
    seats: 10,
    workspaces: Infinity,
  },
};

export function polarConfig() {
  return {
    accessToken: required("POLAR_ACCESS_TOKEN", process.env.POLAR_ACCESS_TOKEN),
    orgId: required("POLAR_ORG_ID", process.env.POLAR_ORG_ID),
    webhookSecret: process.env.POLAR_WEBHOOK_SECRET ?? "",
    productIdPlus: required("POLAR_PRODUCT_ID_PLUS", process.env.POLAR_PRODUCT_ID_PLUS),
    productIdPro: required("POLAR_PRODUCT_ID_PRO", process.env.POLAR_PRODUCT_ID_PRO),
  };
}

/** Map a Polar product id back to the caller's tier. Unknown ids
 *  (e.g. a legacy archived metered product) return null and the
 *  caller falls back to free-tier limits — the safest default. */
export function tierFromProductId(productId: string | null | undefined): Tier | null {
  if (!productId) return null;
  const cfg = polarConfig();
  if (productId === cfg.productIdPlus) return "plus";
  if (productId === cfg.productIdPro) return "pro";
  return null;
}

export function limitsForTier(tier: Tier): TierLimits {
  return TIER_LIMITS[tier];
}
