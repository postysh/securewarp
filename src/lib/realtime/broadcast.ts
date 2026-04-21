import "server-only";
import { supabase } from "@/lib/db/supabase";
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
