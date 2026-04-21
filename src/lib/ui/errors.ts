/**
 * Map raw error objects to user-friendly messages. We never want
 * a visitor to see "Hybrid unwrap failed — wrong key or tampered
 * ciphertext" in the UI — that's developer-facing debugging text
 * that tells users nothing actionable and reads as alarming.
 *
 * Every crypto error from our SDK has a recognizable prefix or
 * keyword; we match on those and return a human-facing sentence.
 * Everything else falls back to the caller's generic fallback.
 *
 * Pair with `console.error(err)` at the catch site so the raw
 * stack stays in the browser console for us to inspect, while
 * the visible message to the user stays calm.
 */

const CRYPTO_ERROR_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /hybrid unwrap failed|hybrid wrap failed/i,
    message: "Something's out of sync here. Try refreshing the page.",
  },
  {
    pattern: /link unwrap failed|wrong link password/i,
    message: "This link couldn't be opened. Check the URL or password and try again.",
  },
  {
    pattern: /invalid tag|chunk.*decryption failed/i,
    message: "Couldn't decrypt this file. Try refreshing the page.",
  },
  {
    pattern: /no decrypt path/i,
    message: "You don't have access to decrypt this file.",
  },
  {
    pattern: /cannot access parent folder/i,
    message: "Can't reach the parent folder right now. Try refreshing.",
  },
];

export function friendlyError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  for (const { pattern, message } of CRYPTO_ERROR_PATTERNS) {
    if (pattern.test(raw)) return message;
  }
  return fallback;
}
