/**
 * Constant-time comparison of two byte arrays.
 *
 * Uses Web-standard APIs only (works in Node, Cloudflare Workers, Deno,
 * the browser). Replaces `crypto.timingSafeEqual` which is Node-only.
 *
 * Returns false if lengths differ (still constant-time once we know the
 * attacker can distinguish length anyway — the UNIX password database
 * threat model).
 */
export function safeCompare(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Decode a base64 string into a Uint8Array.
 *
 * Web-standard replacement for `Buffer.from(str, "base64")` that works
 * everywhere — Node, Workers, browser.
 */
export function base64ToBytes(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode a string as UTF-8 bytes. Web-standard replacement for
 * `Buffer.from(str, "utf8")`.
 */
export function utf8ToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}
