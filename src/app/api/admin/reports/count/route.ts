import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { countReports } from "@/lib/db/reports";
import { logError } from "@/lib/log";

/**
 * GET /api/admin/reports/count — number of pending reports. Drives the
 * sidebar badge. Lightweight, head-only COUNT so polling every 60s is
 * cheap.
 */
export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const pendingCount = await countReports("pending");
    return NextResponse.json({ pendingCount });
  } catch (err) {
    logError("admin.reports.count", err);
    return NextResponse.json({ error: "Failed to count" }, { status: 500 });
  }
}
