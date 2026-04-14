import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const PostSchema = z.object({
  body: z.string().min(1).max(2000),
});

/**
 * List admin-only notes for a user. Any admin/owner can read.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: userId } = await params;
    const { data, error } = await supabase
      .from("admin_notes")
      .select("id, created_at, author_user_id, author_email, body")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ notes: data ?? [] });
  } catch (err) {
    logError("admin.notes.list", err);
    return NextResponse.json({ error: "Failed to list notes" }, { status: 500 });
  }
}

/**
 * Append a note. Store the author's email alongside the ID so the note
 * keeps a readable trail even if the author's account is later deleted.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: userId } = await params;
    const body = await request.json();
    const parsed = PostSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const { data, error } = await supabase
      .from("admin_notes")
      .insert({
        user_id: userId,
        author_user_id: ctx.userId,
        author_email: ctx.email,
        body: parsed.data.body,
      })
      .select("id, created_at, author_user_id, author_email, body")
      .single();
    if (error) throw error;

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "note.create",
      targetUserId: userId,
    });

    return NextResponse.json({ note: data });
  } catch (err) {
    logError("admin.notes.create", err);
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }
}
