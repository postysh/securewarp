import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { broadcastChangelogPublished } from "@/lib/db/notifications";
import { logError } from "@/lib/log";

const CategoryEnum = z.enum(["feature", "improvement", "fix", "security"]);

const PatchSchema = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  body: z.string().trim().min(1).max(8000).optional(),
  category: CategoryEnum.optional(),
  publish: z.boolean().optional(),
});

const SELECT =
  "id, created_at, updated_at, created_by_email, title, body, category, published_at";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { data: current } = await supabase
      .from("changelog_entries")
      .select("published_at")
      .eq("id", id)
      .single();

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.title !== undefined) update.title = parsed.data.title;
    if (parsed.data.body !== undefined) update.body = parsed.data.body;
    if (parsed.data.category !== undefined) update.category = parsed.data.category;

    const goingLive = parsed.data.publish === true && !current?.published_at;
    if (goingLive) {
      update.published_at = new Date().toISOString();
    } else if (parsed.data.publish === false) {
      update.published_at = null;
    }

    const { data, error } = await supabase
      .from("changelog_entries")
      .update(update)
      .eq("id", id)
      .select(SELECT)
      .single();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action:
        parsed.data.publish === true
          ? "changelog.publish"
          : parsed.data.publish === false
          ? "changelog.unpublish"
          : "changelog.edit",
      detail: `id=${id}`,
    });

    if (goingLive) {
      await broadcastChangelogPublished({ title: data.title });
    }

    return NextResponse.json({ entry: data });
  } catch (err) {
    logError("admin.changelog.patch", err);
    return NextResponse.json({ error: "Failed to update entry" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    const { error } = await supabase.from("changelog_entries").delete().eq("id", id);
    if (error) throw error;

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "changelog.delete",
      detail: `id=${id}`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("admin.changelog.delete", err);
    return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 });
  }
}
