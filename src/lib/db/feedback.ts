import "server-only";
import { supabase } from "./supabase";

export type FeedbackCategory = "bug" | "idea" | "other";
export type FeedbackStatus = "new" | "read" | "resolved";

export interface FeedbackRow {
  id: string;
  user_id: string;
  category: FeedbackCategory;
  body: string;
  status: FeedbackStatus;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function createFeedback(data: {
  userId: string;
  category: FeedbackCategory;
  body: string;
}): Promise<FeedbackRow> {
  const { data: row, error } = await supabase
    .from("feedback")
    .insert({
      user_id: data.userId,
      category: data.category,
      body: data.body,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create feedback: ${error.message}`);
  return row;
}

export async function listFeedback(opts: {
  status?: FeedbackStatus | "all";
  limit?: number;
  offset?: number;
}): Promise<{ rows: FeedbackRow[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  let q = supabase.from("feedback").select("*", { count: "exact" });
  if (opts.status && opts.status !== "all") {
    q = q.eq("status", opts.status);
  }
  q = q.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) throw new Error(`Failed to list feedback: ${error.message}`);
  return { rows: (data as FeedbackRow[]) ?? [], total: count ?? 0 };
}

export async function updateFeedback(
  id: string,
  patch: { status?: FeedbackStatus; adminNotes?: string | null },
): Promise<FeedbackRow> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status) updates.status = patch.status;
  if (patch.adminNotes !== undefined) updates.admin_notes = patch.adminNotes;

  const { data, error } = await supabase
    .from("feedback")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(`Failed to update feedback: ${error.message}`);
  return data as FeedbackRow;
}

export async function countNewFeedback(): Promise<number> {
  const { count, error } = await supabase
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  if (error) return 0;
  return count ?? 0;
}
