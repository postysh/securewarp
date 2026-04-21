import "server-only";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * HMAC-signed channel names for Supabase Realtime broadcast.
 *
 * Why HMAC: broadcast channels on Supabase Realtime are public
 * pub/sub with "the channel name IS the auth." Anyone connected
 * to our Supabase project with the anon key can subscribe to any
 * channel name they know. If we used predictable names like
 * `user:<userId>`, an attacker who knew a target's userId could
 * subscribe to their personal event stream. HMAC-signing with a
 * server-side secret makes the channel name unguessable.
 *
 * Client gets the channel names it's allowed to subscribe to via
 * /api/realtime/tokens (authenticated). Server publishes to those
 * same names from route handlers.
 *
 * Rotation: if REALTIME_CHANNEL_SECRET changes, every existing
 * subscription silently stops working (server publishes to NEW
 * channels; clients are listening on OLD names). Graceful
 * degradation — users fall back to polling (if still enabled) or
 * see stale data until next page reload.
 */

function secret(): Uint8Array {
  const raw = process.env.REALTIME_CHANNEL_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error(
      "REALTIME_CHANNEL_SECRET missing or too short (need 32+ chars)",
    );
  }
  return new TextEncoder().encode(raw);
}

function sign(input: string): string {
  const mac = hmac(sha256, secret(), new TextEncoder().encode(input));
  // Truncate to 16 hex chars. 64 bits is plenty of unguessability
  // for "can't brute force a channel name" and keeps the channel
  // string reasonably short on the wire.
  return Array.from(mac.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function channelForUser(userId: string): string {
  return `user:${userId}:${sign(`user:${userId}`)}`;
}

export function channelForWorkspace(workspaceId: string): string {
  return `workspace:${workspaceId}:${sign(`workspace:${workspaceId}`)}`;
}

export function channelForFile(fileId: string): string {
  return `file:${fileId}:${sign(`file:${fileId}`)}`;
}
