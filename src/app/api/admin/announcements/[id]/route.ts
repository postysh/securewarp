import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const SeverityEnum = z.enum(["info", "warning", "critical"]);

// Edit any field, optionally toggle publish state. Set `publish` to
// `true` to stamp published_at=now(), `false` to clear it (unpublish /
// move back to draft). Omit it to leave publish state unchanged.
const PatchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(2000).optional(),
  severity: SeverityEnum.optional(),
  publish: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }

    // Read current publish state so we only re-stamp `published_at` when
    // transitioning from draft → live. Editing the title/body of an
    // already-live announcement shouldn't re-broadcast; explicit
    // unpublish → publish does (that updates published_at, which the
    // active endpoint compares against dismissed_at to decide whether
    // a prior dismissal still counts).
    const { data: current } = await supabase
      .from("announcements")
      .select("published_at")
      .eq("id", id)
      .single();

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.title !== undefined) update.title = parsed.data.title;
    if (parsed.data.body !== undefined) update.body = parsed.data.body;
    if (parsed.data.severity !== undefined) update.severity = parsed.data.severity;
    if (parsed.data.expiresAt !== undefined) update.expires_at = parsed.data.expiresAt;

    if (parsed.data.publish === true && !current?.published_at) {
      update.published_at = new Date().toISOString();
    } else if (parsed.data.publish === false) {
      update.published_at = null;
    }

    const { data, error } = await supabase
      .from("announcements")
      .update(update)
      .eq("id", id)
      .select("id, created_at, updated_at, created_by_email, title, body, severity, published_at, expires_at")
      .single();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action:
        parsed.data.publish === true
          ? "announcement.publish"
          : parsed.data.publish === false
          ? "announcement.unpublish"
          : "announcement.edit",
      detail: `id=${id}`,
    });

    return NextResponse.json({ announcement: data });
  } catch (err) {
    logError("admin.announcements.patch", err);
    return NextResponse.json({ error: "Failed to update announcement" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (error) throw error;

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "announcement.delete",
      detail: `id=${id}`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("admin.announcements.delete", err);
    return NextResponse.json({ error: "Failed to delete announcement" }, { status: 500 });
  }
}
