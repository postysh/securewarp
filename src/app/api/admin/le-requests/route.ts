import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import {
  createLeRequest,
  listLeRequests,
  type LeRequestStatus,
} from "@/lib/db/le-requests";
import { logError } from "@/lib/log";

/**
 * GET  /api/admin/le-requests — list intake rows.
 * POST /api/admin/le-requests — log a new request.
 */

const QUERY = z.object({
  status: z.enum(["pending", "produced", "challenged", "rejected", "all"]).default("all"),
});

const POST_BODY = z.object({
  receivedAt: z.string().datetime(),
  type: z.enum(["subpoena-us", "warrant-us", "preservation-us", "mlat", "nsl", "other"]),
  jurisdiction: z.string().max(200).optional(),
  gagOrderUntil: z.string().datetime().optional(),
  notes: z.string().max(4000).optional(),
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
    const rows = await listLeRequests({
      status:
        parsed.data.status === "all"
          ? undefined
          : (parsed.data.status as LeRequestStatus),
    });
    return NextResponse.json({
      rows: rows.map((r) => ({
        id: r.id,
        receivedAt: r.received_at,
        type: r.type,
        jurisdiction: r.jurisdiction,
        status: r.status,
        producedAt: r.produced_at,
        gagOrderUntil: r.gag_order_until,
        notes: r.notes,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    logError("admin.le-requests.list", err);
    return NextResponse.json({ error: "Failed to list" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json().catch(() => null);
    const parsed = POST_BODY.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }
    const row = await createLeRequest({
      receivedAt: parsed.data.receivedAt,
      type: parsed.data.type,
      jurisdiction: parsed.data.jurisdiction ?? null,
      gagOrderUntil: parsed.data.gagOrderUntil ?? null,
      notes: parsed.data.notes ?? null,
      createdByUserId: ctx.userId,
    });

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "le-request.create",
      detail: `type=${parsed.data.type} jurisdiction=${parsed.data.jurisdiction ?? "—"}`,
    });

    return NextResponse.json({ id: row.id });
  } catch (err) {
    logError("admin.le-requests.create", err);
    return NextResponse.json({ error: "Failed to log request" }, { status: 500 });
  }
}
