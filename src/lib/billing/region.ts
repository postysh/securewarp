/**
 * User-region detection + foundation.
 *
 * We tag every user with an `r2_region` at signup time so we have a
 * place to route their R2 traffic when we eventually provision
 * multi-region bucket sets. Today, ALL users' data lives in the
 * ENAM shards regardless of this value — the routing layer
 * (src/lib/db/r2.ts) is still single-region. This column is purely
 * foundational; it exists so the schema, migration, and detection
 * are in place when we decide to add WNAM / WEUR / APAC bucket sets.
 *
 * When that rollout happens: `bucketForShard(shard)` gets paired
 * with `bucketFor(region, shard)` and every URL-mint site reads the
 * user's region. Existing users already have the right region
 * tagged, so no user-facing migration is needed.
 */

export type R2Region = "enam" | "wnam" | "weur" | "apac";

export const R2_REGIONS: readonly R2Region[] = ["enam", "wnam", "weur", "apac"] as const;

/**
 * Map an ISO 3166-1 alpha-2 country code (from `CF-IPCountry`) to
 * the nearest R2 region. Unknown / missing codes fall back to ENAM
 * since that's where the current bucket set lives.
 */
export function detectRegionFromCountry(country: string | null | undefined): R2Region {
  if (!country) return "enam";
  const cc = country.toUpperCase().trim();
  if (!/^[A-Z]{2}$/.test(cc)) return "enam";

  // Western North America — US Pacific + Mountain states are hard to
  // distinguish from just the country code, so we put the whole of US/CA
  // in ENAM by default. A future UI toggle could let WNAM users opt in.
  // Mexico sits closer to WNAM by geography, but ENAM PoPs (Dallas,
  // Atlanta) are typically closer network-wise for most Mexican users.

  // Western Europe + Nordics + UK + Ireland → WEUR.
  if (
    [
      "GB", "IE",
      "FR", "DE", "NL", "BE", "LU", "CH", "AT", "LI",
      "IT", "ES", "PT", "AD", "MC", "SM", "VA", "MT",
      "SE", "NO", "DK", "FI", "IS",
      "PL", "CZ", "SK", "HU", "SI", "HR",
    ].includes(cc)
  ) {
    return "weur";
  }

  // Asia-Pacific. Japan / Korea / Greater China / SE Asia / Aus-NZ /
  // India. Middle East currently falls back to ENAM since APAC PoPs
  // are further than EU ones for most ME users.
  if (
    [
      "JP", "KR", "CN", "HK", "MO", "TW",
      "SG", "MY", "ID", "TH", "VN", "PH", "KH", "LA", "MM", "BN",
      "IN", "BD", "LK", "NP", "BT",
      "AU", "NZ", "FJ", "PG",
    ].includes(cc)
  ) {
    return "apac";
  }

  // North America + Latin America + anything we don't classify →
  // ENAM (our default bucket region).
  return "enam";
}
