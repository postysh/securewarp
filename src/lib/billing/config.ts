import "server-only";

/**
 * Tier definitions. Vendor-neutral — these limits drive in-app
 * enforcement (upload quota, workspace count, seat cap) and also
 * the UI's tier-picker. Paddle product/price IDs are looked up via
 * paddleConfig() separately; this file doesn't depend on Paddle.
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
 * Paddle configuration. Empty strings during the migration window
 * (pre-credentials). Callers that actually need Paddle should throw
 * if these are missing via `requirePaddleConfig()` below.
 */
export function paddleConfig() {
  return {
    apiKey: process.env.PADDLE_API_KEY ?? "",
    clientToken: process.env.PADDLE_CLIENT_TOKEN ?? "",
    webhookSecret: process.env.PADDLE_WEBHOOK_SECRET ?? "",
    environment: (process.env.PADDLE_ENVIRONMENT ?? "sandbox") as "sandbox" | "production",
    priceIdPlus: process.env.PADDLE_PRICE_ID_PLUS ?? "",
    priceIdPro: process.env.PADDLE_PRICE_ID_PRO ?? "",
  };
}

export function requirePaddleConfig() {
  const cfg = paddleConfig();
  for (const [name, value] of Object.entries(cfg)) {
    if (!value) {
      throw new Error(
        `Paddle not configured: missing ${name.toUpperCase()}. See README.md → Paddle billing.`,
      );
    }
  }
  return cfg as Required<ReturnType<typeof paddleConfig>>;
}

/** Map a Paddle price id back to a tier. */
export function tierFromPriceId(priceId: string | null | undefined): Tier | null {
  if (!priceId) return null;
  const cfg = paddleConfig();
  if (priceId === cfg.priceIdPlus) return "plus";
  if (priceId === cfg.priceIdPro) return "pro";
  return null;
}
