import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { getReportById } from "@/lib/db/reports";
import { getForensicBundle } from "@/lib/db/trust-safety";
import { logError } from "@/lib/log";

/**
 * GET /api/admin/reports/[id]/forensic — returns a JSON bundle of
 * everything we can legally disclose about the uploader named on
 * the report. Drives the "download forensic packet" button on the
 * report card. Content never includes decrypted file contents or
 * filenames — those stay encrypted on the server.
 *
 * Response headers include Content-Disposition: attachment so the
 * browser saves it as a file rather than rendering it. The filename
 * embeds the report id + a timestamp to avoid collisions when an
 * admin downloads the same report twice.
 */

const PARAMS = z.object({ id: z.string().uuid() });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const resolved = await params;
    const paramsParsed = PARAMS.safeParse(resolved);
    if (!paramsParsed.success) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const report = await getReportById(paramsParsed.data.id);
    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const bundle = await getForensicBundle(report.file_owner_id, ctx.userId);
    if (!bundle) {
      return NextResponse.json({ error: "Uploader not found" }, { status: 404 });
    }

    // Include the report's own row inside the envelope so LE has the
    // reporter's claim + category + status alongside the uploader's
    // metadata without needing a second download.
    const envelope = {
      report: {
        id: report.id,
        category: report.category,
        status: report.status,
        details: report.details,
        reporterEmail: report.reporter_email ?? null,
        reporterIpHash: report.reporter_ip_hash ?? null,
        fileId: report.file_id,
        linkId: report.link_id,
        createdAt: report.created_at,
        handledAt: report.handled_at,
        handlerNotes: report.handler_notes,
      },
      bundle,
    };

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "report.forensic",
      targetUserId: report.file_owner_id,
      detail: `report=${report.id}`,
    });

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `forensic-${report.id.slice(0, 8)}-${ts}.json`;

    return new NextResponse(JSON.stringify(envelope, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logError("admin.reports.forensic", err);
    return NextResponse.json({ error: "Forensic export failed" }, { status: 500 });
  }
}
