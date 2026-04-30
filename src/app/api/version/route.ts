import { NextResponse } from "next/server";

/**
 * Returns the deployed worker's build version. The client bundle has
 * its own version baked in at build time as
 * `NEXT_PUBLIC_BUILD_VERSION`; if the value returned here differs
 * from what the client knows, a new deploy has shipped and the user
 * is running stale JS. The update banner uses that signal to prompt
 * a reload so a later dynamic import doesn't 404 on a missing chunk.
 *
 * Returns the same string baked into the client bundle (date · sha)
 * so soft and hard equality checks both work.
 */
export async function GET() {
  return NextResponse.json(
    { version: process.env.NEXT_PUBLIC_BUILD_VERSION ?? "unknown" },
    {
      headers: {
        // Allow short edge caching to absorb the polling herd. 30s is
        // smaller than the client poll interval (60s), so a fresh
        // deploy is detected within ~90s worst case.
        "Cache-Control": "public, max-age=30, s-maxage=30",
      },
    },
  );
}
