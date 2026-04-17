import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { countNewFeedback } from "@/lib/db/feedback";

/**
 * GET /api/admin/feedback/count — lightweight "new feedback" count.
 * The admin layout polls this to decorate the sidebar nav item with
 * a dot indicator. Cheap — it's a head:true count, no row scan.
 */
export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const newCount = await countNewFeedback();
  return NextResponse.json({ newCount });
}
