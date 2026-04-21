import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { pruneVersionsForFile } from "@/lib/db/version-prune";
import { auditEventAwait } from "@/lib/audit";
import { safeCompare, utf8ToBytes } from "@/lib/auth/safe-compare";
import { logError } from "@/lib/log";

/**
 * Daily cron — TTL pruning for version history.
 *
 * Count-based pruning runs inline after every new-version upload
 * (see chunk-upload finalize), so this cron's job is mainly the
 * time-based cap: versions that have aged past the owner's
 * `versionTtlDays` cap get deleted here. It also catches any count
 * drift from aborted inline runs.
 *
 * External scheduler hits POST with Bearer CRON_SECRET. GET is also
 * accepted for Vercel-style injected schedulers.
 */

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) return false;
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  return safeCompare(utf8ToBytes(token), utf8ToBytes(expected));
}

async function run(): Promise<NextResponse> {
  try {
    // Scan files that have more than one version — anything with
    // `version_count` 1 or NULL has nothing to prune by construction.
    // Paginate because a busy account could have thousands of files.
    let from = 0;
    const pageSize = 500;
    let filesScanned = 0;
    let versionsDeleted = 0;
    let blobsPurged = 0;

    // Safety cap: never scan more than 50k files in one run. The cron
    // runs daily, so partial coverage is self-healing.
    const MAX_FILES = 50_000;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data: page, error } = await supabase
        .from("files")
        .select("id, owner_id, version_count")
        .gt("version_count", 1)
        .is("deleted_at", null)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!page || page.length === 0) break;

      for (const row of page) {
        filesScanned++;
        if (filesScanned > MAX_FILES) break;
        try {
          const res = await pruneVersionsForFile(
            row.owner_id as string,
            row.id as string,
          );
          versionsDeleted += res.versionsDeleted;
          blobsPurged += res.blobsPurged;
        } catch (err) {
          logError("cron.prune-versions.file", {
            fileId: row.id,
            err,
          });
        }
      }

      if (filesScanned > MAX_FILES) break;
      if (page.length < pageSize) break;
      from += pageSize;
    }

    await auditEventAwait({
      event: "cleanup.run",
      detail: `source=prune-versions files=${filesScanned} versions=${versionsDeleted} blobs=${blobsPurged}`,
    });

    return NextResponse.json({
      filesScanned,
      versionsDeleted,
      blobsPurged,
    });
  } catch (err) {
    logError("cron.prune-versions", err);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}
