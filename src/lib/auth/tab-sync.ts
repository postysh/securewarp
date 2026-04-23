"use client";

// Cross-tab key sync over BroadcastChannel. Solves "open a new tab
// while already signed in and be prompted to unlock again" — decrypted
// keys live in sessionStorage, which is per-tab, so a second tab with
// the same auth cookie has no key material until the user re-enters
// their password. Rather than persist plaintext keys to localStorage
// (would survive any XSS), we ask sibling tabs for their in-memory
// copy over a same-origin BroadcastChannel.
//
// Security posture:
// - BroadcastChannel is same-origin scoped by spec. A page on a
//   different origin cannot listen on our channel. We set
//   `frame-ancestors 'none'` on the main app, so no attacker site
//   can iframe us and snoop on channel traffic from inside our own
//   origin either.
// - Same-origin XSS already has sessionStorage access, so exposing
//   keys on a same-origin channel doesn't widen the blast radius.
// - Request carries a one-shot UUID nonce; only the response matching
//   that nonce is accepted, so a stale response from a prior request
//   can't be consumed by the current one.
// - Responders read directly from sessionStorage at request time.
//   Tabs without keys stay silent. The requesting tab times out
//   after `REQUEST_TIMEOUT_MS` and falls back to the unlock form.

const CHANNEL_NAME = "securewarp-tab-sync";
const REQUEST_TIMEOUT_MS = 500;
const KEYS_STORAGE_KEY = "securewarp_keys";

type Message =
  | { type: "keys-request"; nonce: string }
  | { type: "keys-response"; nonce: string; keys: unknown };

function hasBroadcastChannel(): boolean {
  return typeof window !== "undefined" && "BroadcastChannel" in window;
}

/**
 * Ask sibling tabs for the current user's decrypted keys. Resolves
 * with the key blob (parsed JSON) if a sibling responds within the
 * timeout, or `null` if none do. Callers should write the result to
 * sessionStorage and dispatch `securewarp-keys-updated` so the rest
 * of the app picks them up.
 */
export function requestKeysFromSiblings(): Promise<unknown | null> {
  return new Promise((resolve) => {
    if (!hasBroadcastChannel()) {
      resolve(null);
      return;
    }
    const channel = new BroadcastChannel(CHANNEL_NAME);
    const nonce = crypto.randomUUID();
    let settled = false;
    const finish = (keys: unknown | null) => {
      if (settled) return;
      settled = true;
      channel.close();
      resolve(keys);
    };
    channel.onmessage = (ev: MessageEvent<Message>) => {
      const msg = ev.data;
      if (msg && msg.type === "keys-response" && msg.nonce === nonce && msg.keys) {
        finish(msg.keys);
      }
    };
    const req: Message = { type: "keys-request", nonce };
    channel.postMessage(req);
    setTimeout(() => finish(null), REQUEST_TIMEOUT_MS);
  });
}

let responder: BroadcastChannel | null = null;

/**
 * Begin responding to sibling `keys-request` messages. Idempotent —
 * repeat calls are no-ops. Responders read the current keys from
 * sessionStorage on each request, so a tab that logs in later starts
 * responding automatically without re-registration.
 */
export function startKeysResponder(): void {
  if (!hasBroadcastChannel() || responder) return;
  responder = new BroadcastChannel(CHANNEL_NAME);
  responder.onmessage = (ev: MessageEvent<Message>) => {
    const msg = ev.data;
    if (!msg || msg.type !== "keys-request") return;
    const stored = sessionStorage.getItem(KEYS_STORAGE_KEY);
    if (!stored) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      return;
    }
    const res: Message = { type: "keys-response", nonce: msg.nonce, keys: parsed };
    responder?.postMessage(res);
  };
}

export function stopKeysResponder(): void {
  responder?.close();
  responder = null;
}
