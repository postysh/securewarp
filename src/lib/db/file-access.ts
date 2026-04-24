import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Record that a user just opened/interacted with a file or folder.
 * Upserts `(user_id, file_id) → accessed_at = now()`.
 *
 * AWAITED, not fire-and-forget. We tried the fire-and-forget pattern
 * first and it broke Recent on Cloudflare Workers: once the HTTP
 * response is sent the worker instance can be recycled, which kills
 * any in-flight supabase call before it commits. The access row
 * never gets written, so the file the user just renamed/opened/moved
 * doesn't move up in their Recent view. ~20–50 ms on the response
 * path is a worthwhile tradeoff for the feature actually working.
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
    );
  if (error) logError("file-access.record", error);
}
