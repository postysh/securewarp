import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Record that a user just opened/interacted with a file or folder.
 * Awaited (not fire-and-forget) so the write commits before the
 * Worker instance can be recycled on response send.
 *
 * Noisy logging temporarily while we diagnose why writes aren't
 * landing in production — strip after the Recent view is confirmed
 * working end-to-end.
 */
export async function recordFileAccess(userId: string, fileId: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ctx: "file-access.enter", userId, fileId }));
  const res = await supabase
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
  if (res.error) {
    logError("file-access.record", res.error);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ctx: "file-access.ok",
    userId,
    fileId,
    rowsReturned: Array.isArray(res.data) ? res.data.length : 0,
  }));
}
