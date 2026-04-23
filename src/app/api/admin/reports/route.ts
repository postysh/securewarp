import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { listReportsWithContext } from "@/lib/db/reports";
import { logError } from "@/lib/log";

/**
 * GET /api/admin/reports — paginated list of abuse reports with joined
 * context (file owner email, link status, file size/age). Admin-only.
 *
 * Crypto note: filenames and file contents are E2E-encrypted on the
 * client; admins NEVER see decrypted names. Enforcement decisions are
 * based on metadata (size, timestamps), the reporter's written claim,
 * and the reporter's IP hash for dedup. That's the deliberate tradeoff
 * of a zero-knowledge product.
 */

const QUERY = z.object({
  status: z.enum(["pending", "dismissed", "actioned", "escalated", "all"]).default("pending"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
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

    const rows = await listReportsWithContext({
      status: parsed.data.status === "all" ? undefined : parsed.data.status,
      limit: parsed.data.limit,
    });

    return NextResponse.json({
      rows: rows.map((r) => ({
        id: r.id,
        category: r.category,
        details: r.details,
        status: r.status,
        createdAt: r.created_at,
        handledAt: r.handled_at,
        handlerNotes: r.handler_notes,
        reporterEmail: r.reporterUserEmail ?? r.reporter_email,
        reporterIsRegistered: !!r.reporter_user_id,
        fileId: r.file_id,
        linkId: r.link_id,
        ownerEmail: r.ownerEmail,
        ownerSuspendedAt: r.ownerSuspendedAt,
        fileSizeBytes: r.fileSizeBytes,
        fileCreatedAt: r.fileCreatedAt,
        fileDeletedAt: r.fileDeletedAt,
        fileUploadComplete: r.fileUploadComplete,
        linkRevokedAt: r.linkRevokedAt,
        linkExpiresAt: r.linkExpiresAt,
      })),
    });
  } catch (err) {
    logError("admin.reports.list", err);
    return NextResponse.json({ error: "Failed to list reports" }, { status: 500 });
  }
}
