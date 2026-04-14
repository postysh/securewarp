import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const SeverityEnum = z.enum(["info", "warning", "critical"]);

const CreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  severity: SeverityEnum.default("info"),
  publish: z.boolean().default(false),
  expiresAt: z.string().datetime().nullable().optional(),
});

/**
 * List every announcement (drafts + published + expired). Admin view.
 * Order: published first (most recent), drafts after.
 */
export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { data, error } = await supabase
      .from("announcements")
      .select("id, created_at, updated_at, created_by_email, title, body, severity, published_at, expires_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ announcements: data ?? [] });
  } catch (err) {
    logError("admin.announcements.list", err);
    return NextResponse.json({ error: "Failed to load announcements" }, { status: 500 });
  }
}

/**
 * Create a new announcement. `publish: true` sets published_at to now()
 * immediately; otherwise it's a draft until patched.
 */
export async function POST(request: Request) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("announcements")
      .insert({
        created_by: ctx.userId,
        created_by_email: ctx.email,
        title: parsed.data.title,
        body: parsed.data.body,
        severity: parsed.data.severity,
        published_at: parsed.data.publish ? new Date().toISOString() : null,
        expires_at: parsed.data.expiresAt ?? null,
      })
      .select("id, created_at, updated_at, created_by_email, title, body, severity, published_at, expires_at")
      .single();
    if (error) throw error;

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: parsed.data.publish ? "announcement.publish" : "announcement.draft",
      detail: `id=${data.id} severity=${data.severity}`,
    });

    return NextResponse.json({ announcement: data });
  } catch (err) {
    logError("admin.announcements.create", err);
    return NextResponse.json({ error: "Failed to create announcement" }, { status: 500 });
  }
}
