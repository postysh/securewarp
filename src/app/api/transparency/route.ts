import { NextResponse } from "next/server";
import { aggregateTransparency, defaultPeriod } from "@/lib/db/transparency";
import { logError } from "@/lib/log";

/**
 * GET /api/transparency — public. Returns the current reporting
 * period's aggregated counts. Default window is calendar year to
 * date; the page renders this live so numbers stay accurate without
 * a manual publish step. When we're ready to freeze snapshots for
 * an archive, a follow-up will store each closed period in its own
 * table and this endpoint will serve those instead.
 *
 * No auth — this is the data behind /transparency.
 *
 * Caching: 5-minute s-maxage. Transparency numbers don't move by
 * the second and the public page shouldn't put live pressure on
 * Postgres. If an admin needs a fresh view the admin preview
 * endpoint (`/api/admin/transparency`, not yet added) can skip
 * the cache.
 */
export async function GET() {
  try {
    const { periodStart, periodEnd } = defaultPeriod();
    const report = await aggregateTransparency(periodStart, periodEnd);
    return NextResponse.json(report, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    logError("transparency.aggregate", err);
    return NextResponse.json(
      { error: "Transparency report unavailable" },
      { status: 500 },
    );
  }
}
