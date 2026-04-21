"use client";

import { useEffect, useRef } from "react";
import { supabaseClient } from "@/lib/db/supabase-client";

/**
 * Subscribe to a Supabase Realtime broadcast channel. Calls
 * `onEvent` with each broadcast message while the component is
 * mounted. Unsubscribes cleanly on unmount or channel change.
 *
 * Channel names come from /api/realtime/tokens — they're
 * HMAC-signed so anon visitors can't subscribe to other users'
 * event streams.
 *
 * Callers should keep `onEvent` stable (useCallback) so the hook
 * doesn't tear down + re-subscribe on every render. We stash it
 * in a ref so the channel subscription survives callback
 * identity changes, which is what you want — mid-session the
 * callback closures over fresh state but the wire-level
 * subscription doesn't need to thrash.
 */
export function useRealtimeChannel(
  channelName: string | null,
  onEvent: (event: string, payload: Record<string, unknown>) => void,
): void {
  const savedOnEvent = useRef(onEvent);
  savedOnEvent.current = onEvent;

  useEffect(() => {
    const client = supabaseClient;
    if (!channelName || !client) return;

    const channel = client.channel(channelName, {
      config: {
        // We only need broadcast. Not doing presence or postgres_changes.
        broadcast: { self: false },
      },
    });

    // Match any event name — the event key is part of the payload
    // handoff, so the caller decides what to do with each type
    // (`file.created`, `workspace.member_removed`, etc.).
    channel.on("broadcast", { event: "*" }, ({ event, payload }) => {
      savedOnEvent.current(event, payload ?? {});
    });

    channel.subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [channelName]);
}
