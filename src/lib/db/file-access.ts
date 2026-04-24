import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Record that a user just opened/interacted with a file or folder.
 * Awaited (not fire-and-forget) so the write commits before the
 * Worker instance can be recycled on response send — the
 * fire-and-forget variant silently dropped most writes on CF.
 *
 * `.select()` is chained so supabase-js sends
 * `Prefer: return=representation` instead of the default
 * `return=minimal`. return=minimal was correlated with the upsert
 * appearing to succeed on the client while the row was never
 * actually written; forcing a representation round-trip pins the
 * commit to a concrete response the worker waits on.
 */
export async function recordFileAccess(userId: string, fileId: string): Promise<void> {
  const { error } = await supabase
    .from("user_file_access")
    .upsert(
      {
        user_id: userId,
        file_id: fileId,
        accessed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,file_id" },
    )
    .select();
  if (error) logError("file-access.record", error);
}
