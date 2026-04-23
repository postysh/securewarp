import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Record that a user just opened/interacted with a file or folder.
 * Upserts `(user_id, file_id) → accessed_at = now()`.
 *
 * Fire-and-forget: callers should NOT await this on the response
 * path. A failure to record access is not a user-visible error — we
 * just log it and let the normal response continue.
 */
export function recordFileAccess(userId: string, fileId: string): void {
  void supabase
    .from("user_file_access")
    .upsert(
      {
        user_id: userId,
        file_id: fileId,
        accessed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,file_id" },
    )
    .then((res) => {
      if (res.error) logError("file-access.record", res.error);
    });
}
