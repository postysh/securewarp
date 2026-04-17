import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { listFeedback } from "@/lib/db/feedback";
import { logError } from "@/lib/log";

/**
 * GET /api/admin/feedback — paginated list of user-submitted feedback.
 *
 * Admin-only. Response deliberately EXCLUDES any identifying info about
 * the submitter (no email, no display name, no user_id). Matches the
 * product promise that feedback is anonymous to admins; the user_id is
 * still on the row for rate-limit + abuse-triage purposes but admins
 * don't see it in the UI.
 *
 * Query params:
 *   status=new|read|resolved|all (default: new)
 *   limit=1..100 (default: 50)
 *   offset=0..inf (default: 0)
 */
const QUERY = z.object({
  status: z.enum(["new", "read", "resolved", "all"]).default("new"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: Request) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const url = new URL(request.url);
    const parsed = QUERY.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const { rows, total } = await listFeedback({
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });

    // Strip user_id before returning. The DB keeps it; the wire doesn't.
    return NextResponse.json({
      total,
      rows: rows.map((r) => ({
        id: r.id,
        category: r.category,
        body: r.body,
        status: r.status,
        adminNotes: r.admin_notes,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    logError("admin.feedback.list", err);
    return NextResponse.json({ error: "Failed to fetch feedback" }, { status: 500 });
  }
}
