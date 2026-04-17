import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { updateFeedback } from "@/lib/db/feedback";
import { logError } from "@/lib/log";

/**
 * PATCH /api/admin/feedback/[id] — admin updates status and/or notes.
 * Admin-only. Emits admin_audit row on every change so the trail exists
 * regardless of what was changed.
 */

const BODY = z.object({
  status: z.enum(["new", "read", "resolved"]).optional(),
  adminNotes: z.string().max(2000).nullable().optional(),
});

const PARAMS = z.object({ id: z.string().uuid() });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const resolvedParams = await params;
    const paramsParsed = PARAMS.safeParse(resolvedParams);
    if (!paramsParsed.success) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const bodyParsed = BODY.safeParse(await request.json().catch(() => null));
    if (!bodyParsed.success || (!bodyParsed.data.status && bodyParsed.data.adminNotes === undefined)) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await updateFeedback(paramsParsed.data.id, {
      status: bodyParsed.data.status,
      adminNotes: bodyParsed.data.adminNotes,
    });

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "feedback.update",
      detail: bodyParsed.data.status ? `status=${bodyParsed.data.status}` : "notes",
    });

    return NextResponse.json({
      id: updated.id,
      category: updated.category,
      body: updated.body,
      status: updated.status,
      adminNotes: updated.admin_notes,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    });
  } catch (err) {
    logError("admin.feedback.update", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
