import "server-only";
import { supabase } from "@/lib/db/supabase";
import { channelForWorkspace } from "@/lib/realtime/channels";
import { logError } from "@/lib/log";

/**
 * Publish a Supabase Realtime broadcast event to a channel.
 *
 * Fire-and-forget style: broadcasts are a UX nicety, never
 * load-bearing for correctness. A failed broadcast just means
 * subscribers don't get the push and will see the change on the
 * next polling fallback / navigation / refocus. We log but don't
 * throw — route handlers must keep returning success responses.
 *
 * Payloads should be small and not contain any decrypted data.
 * Broadcast messages traverse Supabase's edge; treat them like
 * any other server response that flows over the wire — public
 * keys and file ids are fine, plaintext metadata or session keys
 * are not.
 */
export async function broadcast(
  channel: string,
  event: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    const ch = supabase.channel(channel);
    await ch.send({
      type: "broadcast",
      event,
      payload: { ...payload, at: new Date().toISOString() },
    });
    // Release the channel resources immediately — we don't hold
    // the connection, each publish is a one-shot.
    await supabase.removeChannel(ch);
  } catch (err) {
    logError("realtime.broadcast", { channel, event, err });
  }
}

/**
 * Broadcast a file mutation to its workspace channel, if any.
 * No-op for personal-drive files (no workspace membership to
 * notify — direct collaborators will see the change on focus
 * refresh / next navigation).
 *
 * Helper exists so route handlers can `await fileMutation(...)`
 * without repeating the "fetch the workspace_id, then publish"
 * dance per site.
 */
export async function broadcastFileMutation(
  fileId: string,
  event:
    | "file.created"
    | "file.renamed"
    | "file.moved"
    | "file.trashed"
    | "file.restored"
    | "file.purged"
    | "file.new_version",
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { data } = await supabase
      .from("files")
      .select("workspace_id")
      .eq("id", fileId)
      .maybeSingle();
    const workspaceId = (data?.workspace_id as string | null) ?? null;
    if (!workspaceId) return;
    await broadcast(channelForWorkspace(workspaceId), event, {
      fileId,
      ...extra,
    });
  } catch (err) {
    logError("realtime.broadcastFileMutation", { fileId, event, err });
  }
}
