import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { anonymousRateLimitKey } from "@/lib/auth/link-access";
import { createReport, hashIp, hasRecentDuplicate } from "@/lib/db/reports";
import { logError } from "@/lib/log";

/**
 * Accept an abuse report against a file or share link.
 *
 * Two entry points share one endpoint:
 *
 * 1. **Authenticated**: a signed-in user reports a file they can
 *    access (have a `file_keys` row or inherited access). We verify
 *    access before accepting so users can't spam-report random
 *    fileIds they don't have a handle for.
 * 2. **Anonymous**: a share-link visitor reports via the linkId.
 *    We verify the link exists and is not revoked; the link itself
 *    is the access proof.
 *
 * Zero-knowledge note: we NEVER look at the file's content. The
 * admin reviewer sees only the reporter's written claim + file
 * metadata. Enforcement (termination, NCMEC escalation) is based
 * on the report + metadata signals, not on inspecting ciphertext.
 */

const BodySchema = z
  .object({
    fileId: z.string().uuid().optional(),
    linkId: z.string().uuid().optional(),
    category: z.enum([
      "csam",
      "harassment",
      "malware",
      "copyright",
      "illegal",
      "other",
    ]),
    details: z.string().min(10).max(2000),
    // Optional contact email for the reporter so we can follow up.
    // Ignored for authenticated users (we already have their email).
    reporterEmail: z.string().email().max(256).optional(),
  })
  .refine((v) => !!v.fileId || !!v.linkId, {
    message: "fileId or linkId is required",
  });

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }
    const { fileId, linkId, category, details, reporterEmail } = parsed.data;

    const session = await getSession();

    // Rate-limit before any DB work. Authed callers are throttled by
    // userId; anonymous callers by IP. Threshold is generous — abuse
    // reports are low-frequency by nature — but catches a single
    // actor spamming the queue.
    const limitKey = session
      ? `abuse-report:user:${session.userId}`
      : anonymousRateLimitKey(request, "abuse-report");
    if (!(await checkRateLimit(limitKey, 10))) {
      return NextResponse.json(
        { error: "Too many reports. Try again later." },
        { status: 429 },
      );
    }

    // IP hash — optional, used for duplicate suppression and admin
    // pattern detection. `cf-connecting-ip` is the canonical source
    // behind CF; fall back through the usual forwarded headers.
    const rawIp =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-vercel-forwarded-for") ??
      (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null);
    const reporterIpHash = rawIp ? await hashIp(rawIp) : null;

    // Dedup: same IP, same file, same 10-minute window → no-op 200.
    // Gives the reporter a confirmation either way without letting
    // them flood the queue.
    if (reporterIpHash) {
      const dup = await hasRecentDuplicate(reporterIpHash, fileId ?? null);
      if (dup) return NextResponse.json({ ok: true, deduped: true });
    }

    // ── Resolve the target file + verify reporter access ──
    // fileId path (authed only): the caller must have a file_keys row
    // (direct grant) or inherited access. We use the existing
    // `getFileForDownload` gate which does both checks.
    // linkId path: lookup the link row, verify not revoked, derive
    // the target file_id from it. Anonymous is fine here — the link
    // is itself the access proof.
    let targetFileId: string | null = null;
    let targetOwnerId: string | null = null;
    let targetWorkspaceId: string | null = null;

    if (fileId) {
      if (!session) {
        return NextResponse.json(
          { error: "Sign in to report this file" },
          { status: 401 },
        );
      }
      // Only accept if the user has some legitimate access claim.
      // Use getFileForDownload which already covers direct + inherited.
      const { getFileForDownload } = await import("@/lib/db/files");
      const result = await getFileForDownload(fileId, session.userId);
      if (!result) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      targetFileId = result.file.id;
      targetOwnerId = result.file.owner_id ?? null;
      targetWorkspaceId = (result.file as unknown as { workspace_id?: string | null }).workspace_id ?? null;
    } else if (linkId) {
      // Anonymous report via share link.
      const { data: link } = await supabase
        .from("file_links")
        .select("id, file_id, revoked_at, expires_at, files:files!inner(id, owner_id, workspace_id)")
        .eq("id", linkId)
        .single();
      if (!link) {
        return NextResponse.json({ error: "Link not found" }, { status: 404 });
      }
      if (link.revoked_at) {
        return NextResponse.json({ error: "Link revoked" }, { status: 410 });
      }
      const file = (link as { files: { id: string; owner_id: string; workspace_id: string | null } | { id: string; owner_id: string; workspace_id: string | null }[] }).files;
      const fileRow = Array.isArray(file) ? file[0] : file;
      if (!fileRow) {
        return NextResponse.json({ error: "File missing" }, { status: 404 });
      }
      targetFileId = fileRow.id;
      targetOwnerId = fileRow.owner_id;
      targetWorkspaceId = fileRow.workspace_id;
    }

    if (!targetOwnerId) {
      return NextResponse.json({ error: "Cannot resolve file" }, { status: 400 });
    }

    const row = await createReport({
      fileId: targetFileId,
      linkId: linkId ?? null,
      fileOwnerId: targetOwnerId,
      fileWorkspaceId: targetWorkspaceId,
      reporterUserId: session?.userId ?? null,
      reporterEmail: session ? null : (reporterEmail ?? null),
      reporterIpHash,
      category,
      details,
    });

    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    logError("abuse.report", err);
    return NextResponse.json({ error: "Report failed" }, { status: 500 });
  }
}
