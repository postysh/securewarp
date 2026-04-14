import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";

/**
 * Admin UI uses this to check whether the current session has admin
 * access. Returns 403 for non-admins; returns role for admins/owners.
 * The layout page calls it and redirects to /drive if forbidden.
 */
export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ userId: ctx.userId, email: ctx.email, role: ctx.role });
}
