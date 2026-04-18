import "server-only";

/**
 * Polar.sh billing configuration. Reads IDs from env so we can point
 * the same code at a separate test/staging org later without code
 * changes. Event names are canonical constants used by both the
 * metering cron (producer) and the Polar meter filters (consumer).
 *
 * Pricing model summary (mirrored server-side + on landing copy):
 *  - Free tier: 20 GB, 1 workspace, 1 user. No Polar subscription;
 *    enforced in the app's quota gate.
 *  - SecureWarp Pro (this product): pay-as-you-go, billed monthly.
 *    Three metered prices, one per meter below. No fixed base fee.
 *    All allowances live server-side; Polar bills from unit #1.
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

export const POLAR_EVENTS = {
  STORAGE_DAILY: "storage.daily",
  SEATS_DAILY: "seats.daily",
  WORKSPACES_DAILY: "workspaces.daily",
} as const;

// Unit prices in cents/unit-month (what the customer sees on the bill).
// Meter aggregation is `avg`, so average usage during the period × unit
// price = line item. Changing these re-prices everyone immediately —
// coordinate with any landing-page copy before adjusting.
export const POLAR_UNIT_CENTS = {
  STORAGE_PER_GB_MONTH: 2,
  SEAT_PER_MONTH: 500,
  WORKSPACE_PER_MONTH: 300,
} as const;

export function polarConfig() {
  return {
    accessToken: required("POLAR_ACCESS_TOKEN", process.env.POLAR_ACCESS_TOKEN),
    orgId: required("POLAR_ORG_ID", process.env.POLAR_ORG_ID),
    webhookSecret: process.env.POLAR_WEBHOOK_SECRET ?? "",
    productIdPro: required("POLAR_PRODUCT_ID_PRO", process.env.POLAR_PRODUCT_ID_PRO),
    meterIds: {
      storage: required("POLAR_METER_STORAGE_ID", process.env.POLAR_METER_STORAGE_ID),
      seats: required("POLAR_METER_SEATS_ID", process.env.POLAR_METER_SEATS_ID),
      workspaces: required("POLAR_METER_WORKSPACES_ID", process.env.POLAR_METER_WORKSPACES_ID),
    },
  };
}

/** Free-tier allowances enforced server-side. Values bump requires a
 *  migration note in CHANGELOG so support can answer "why did my
 *  storage cap move" questions. */
export const FREE_TIER = {
  storageGB: 20,
  seats: 1, // the owner
  workspaces: 1,
} as const;
