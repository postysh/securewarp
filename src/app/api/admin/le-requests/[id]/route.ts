import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { updateLeRequest } from "@/lib/db/le-requests";
import { logError } from "@/lib/log";

const PARAMS = z.object({ id: z.string().uuid() });
const BODY = z.object({
  status: z.enum(["pending", "produced", "challenged", "rejected"]).optional(),
  producedAt: z.string().datetime().nullable().optional(),
  gagOrderUntil: z.string().datetime().nullable().optional(),
  jurisdiction: z.string().max(200).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const resolved = await params;
    const pp = PARAMS.safeParse(resolved);
    if (!pp.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const body = await request.json().catch(() => null);
    const bp = BODY.safeParse(body);
    if (!bp.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const row = await updateLeRequest(pp.data.id, bp.data);

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "le-request.update",
      detail: `id=${row.id} status=${row.status}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("admin.le-requests.update", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
