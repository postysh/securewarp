import "server-only";
import postgres, { type Sql } from "postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Direct Postgres client, pooled at the Cloudflare edge via Hyperdrive.
 *
 * Why bypass @supabase/supabase-js on hot paths:
 * - supabase-js proxies through Supabase's REST (PostgREST) gateway.
 *   Every query is a full HTTP round-trip from our Worker to Supabase's
 *   region, with fresh connection setup.
 * - Hyperdrive keeps a warm Postgres connection pool at the edge near
 *   our Worker, so the per-query cost is just the SQL itself.
 * - Supabase's Hyperdrive integration docs recommend `postgres.js` or
 *   `pg` directly against the DIRECT connection string (not the pooled
 *   one — Hyperdrive handles pooling).
 *
 * Zero-knowledge stance unchanged: we already run with the
 * service-role client that bypasses RLS, so moving to a direct
 * Postgres connection as the `postgres` (owner) role preserves the
 * "correctness lives in the API layer" invariant. Ciphertext stays
 * ciphertext; we never read filenames / content / key material here.
 *
 * Graceful fallback: when the HYPERDRIVE binding isn't attached
 * (preview / local-dev deploys without Hyperdrive wired yet), the
 * helper returns `null` and callers fall back to the supabase-js
 * path. No route silently breaks mid-migration.
 */

interface HyperdriveBinding {
  // The Hyperdrive runtime binding exposes `connectionString` that the
  // Postgres driver connects to instead of the real database. Under
  // the hood the Worker talks to Hyperdrive at the edge, which talks
  // to the origin DB over a pooled + warm connection.
  connectionString: string;
}

let _client: Sql | null | undefined;

function getClient(): Sql | null {
  if (_client !== undefined) return _client;
  let hd: HyperdriveBinding | undefined;
  try {
    const ctx = getCloudflareContext({ async: false });
    hd = (ctx?.env as { HYPERDRIVE?: HyperdriveBinding } | undefined)?.HYPERDRIVE;
  } catch {
    // Dev mode / Node runtime without a CF binding — fall through.
    hd = undefined;
  }
  if (!hd?.connectionString) {
    _client = null;
    return null;
  }
  // Workers runtime has tight per-request CPU budgets, so we
  // configure the driver for short-lived queries and no long-lived
  // connections of our own — Hyperdrive pools for us.
  _client = postgres(hd.connectionString, {
    // max=5 so a single request doesn't monopolize the pool when the
    // worker fans out parallel queries (/api/boot issues ~7 at once).
    max: 5,
    // Short timeouts so a slow DB doesn't pin CPU time to the Worker's
    // 50 ms limit — Hyperdrive caches repeat queries, so first-use
    // cold paths are the worst case.
    idle_timeout: 20,
    connect_timeout: 10,
    // prepare:false because Hyperdrive's pooler is in transaction mode
    // and named prepared statements are connection-local — reusing a
    // name across pooled connections errors out. postgres.js docs
    // recommend this exact setting for PgBouncer/Hyperdrive transaction
    // pooling.
    prepare: false,
    // Server-side ceiling per query. Belt-and-braces with the
    // per-loader Promise.race timeout in /api/boot/route.ts — that
    // one stops the Worker from waiting; this one stops Postgres
    // from doing wasted work after the Worker has already moved on.
    // 15s sits below CF's ~30s hang detector and well above any
    // healthy query (boot's heaviest leg, the per-owner files
    // SUM/COUNT, runs in tens of ms in steady state). Sent in the
    // startup packet so transaction-mode pooling can't strand it.
    connection: {
      statement_timeout: 15000,
    },
  });
  return _client;
}

/**
 * Returns the pooled `postgres` tagged-template client, or `null` if
 * Hyperdrive isn't available for this deploy. Call sites should
 * branch on null and fall back to the supabase-js path.
 */
export function getPg(): Sql | null {
  return getClient();
}

/**
 * True when the Hyperdrive binding is present. Lightweight check
 * for feature-gating migrated routes without forcing a client
 * allocation.
 */
export function hasHyperdrive(): boolean {
  return getClient() !== null;
}
