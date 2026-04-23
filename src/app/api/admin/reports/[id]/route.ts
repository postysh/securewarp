import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { getReportById, updateReportStatus } from "@/lib/db/reports";
import { logError } from "@/lib/log";

/**
 * PATCH /api/admin/reports/[id] — admin updates the report status and
 * optional handler notes. Every change hits admin_audit so there's an
 * immutable trail of who closed/escalated what.
 */

const BODY = z.object({
  status: z.enum(["pending", "dismissed", "actioned", "escalated"]),
  handlerNotes: z.string().max(2000).nullable().optional(),
});

const PARAMS = z.object({ id: z.string().uuid() });

export async function PATCH(
  request: Request,
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

    const body = await request.json().catch(() => null);
    const parsed = BODY.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const existing = await getReportById(paramsParsed.data.id);
    if (!existing) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    await updateReportStatus(paramsParsed.data.id, {
      status: parsed.data.status,
      handledByUserId: ctx.userId,
      handlerNotes: parsed.data.handlerNotes ?? null,
    });

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "report.update",
      targetUserId: existing.file_owner_id,
      detail: `report=${paramsParsed.data.id} status=${parsed.data.status} category=${existing.category}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("admin.reports.update", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
