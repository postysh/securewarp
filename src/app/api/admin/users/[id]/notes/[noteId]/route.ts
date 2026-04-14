import { NextResponse } from "next/server";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Delete an admin note. Only the original author OR an owner can delete —
 * admins shouldn't silently edit each other's context trails.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: userId, noteId } = await params;
    const noteIdNum = Number(noteId);
    if (!Number.isFinite(noteIdNum)) {
      return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
    }

    const { data: note, error: fetchErr } = await supabase
      .from("admin_notes")
      .select("id, author_user_id")
      .eq("id", noteIdNum)
      .eq("user_id", userId)
      .single();
    if (fetchErr || !note) return NextResponse.json({ error: "Note not found" }, { status: 404 });

    if (note.author_user_id !== ctx.userId && ctx.role !== "owner") {
      return NextResponse.json({ error: "Can only delete your own notes" }, { status: 403 });
    }

    const { error } = await supabase.from("admin_notes").delete().eq("id", noteIdNum);
    if (error) throw error;

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "note.delete",
      targetUserId: userId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("admin.notes.delete", err);
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}
