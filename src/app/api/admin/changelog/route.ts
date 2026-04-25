import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { broadcastChangelogPublished } from "@/lib/db/notifications";
import { logError } from "@/lib/log";

const CategoryEnum = z.enum(["feature", "improvement", "fix", "security"]);

const CreateSchema = z.object({
  title: z.string().trim().min(1).max(140),
  body: z.string().trim().min(1).max(8000),
  category: CategoryEnum.default("feature"),
  publish: z.boolean().default(false),
});

const SELECT =
  "id, created_at, updated_at, created_by_email, title, body, category, published_at";

export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { data, error } = await supabase
      .from("changelog_entries")
      .select(SELECT)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ entries: data ?? [] });
  } catch (err) {
    logError("admin.changelog.list", err);
    return NextResponse.json({ error: "Failed to load changelog" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("changelog_entries")
      .insert({
        created_by: ctx.userId,
        created_by_email: ctx.email,
        title: parsed.data.title,
        body: parsed.data.body,
        category: parsed.data.category,
        published_at: parsed.data.publish ? new Date().toISOString() : null,
      })
      .select(SELECT)
      .single();
    if (error) throw error;

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: parsed.data.publish ? "changelog.publish" : "changelog.draft",
      detail: `id=${data.id} category=${data.category}`,
    });

    if (parsed.data.publish) {
      await broadcastChangelogPublished({ title: data.title });
    }

    return NextResponse.json({ entry: data });
  } catch (err) {
    logError("admin.changelog.create", err);
    return NextResponse.json({ error: "Failed to create entry" }, { status: 500 });
  }
}
