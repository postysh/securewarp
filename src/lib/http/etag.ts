import "server-only";
import { NextResponse } from "next/server";

/**
 * Lightweight ETag / If-None-Match support for the polling endpoints.
 *
 * Why it matters: the drive client polls the workspace list + current
 * folder file list on a 20s interval. Most of those polls return
 * "nothing changed" — users don't upload every 20s. Without
 * conditional requests, every poll ships the full JSON payload
 * (5-50KB) even when the client already has it. Multiplied across
 * 1k-10k active users, egress becomes the dominant cost line on
 * Supabase + the outbound side of Cloudflare Workers.
 *
 * With ETag: the server hashes the response body, sets
 * `ETag: "<hash>"` and `Cache-Control: private, max-age=0,
 * must-revalidate`. On the next poll, the browser automatically
 * sends `If-None-Match: "<hash>"`. If the hash still matches, we
 * return 304 with an empty body (~100 bytes of headers only).
 *
 * Tradeoff: we still run the DB queries to BUILD the response. We
 * only save bandwidth, not compute. If DB load becomes the problem,
 * add a cheaper "have contents changed" gate upstream (e.g., check
 * MAX(updated_at) first). For now the DB reads are cheap and
 * bandwidth is where the bill hurts.
 */

/**
 * Hash a JSON-serializable payload into an ETag string. SHA-256,
 * truncated to 16 hex chars — plenty of entropy to avoid
 * collisions at our scale, keeps the header small.
 */
export async function etagForJson(payload: unknown): Promise<string> {
  const body = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(body);
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Quotation marks are required per RFC 7232.
  return `"${hex.slice(0, 16)}"`;
}

/**
 * If the request's If-None-Match header matches the computed ETag,
 * return a 304 response. Otherwise return a 200 with the payload
 * and the ETag + cache-control headers set.
 *
 * Keep the body computation OUTSIDE this helper — callers should
 * still run their DB queries and build `payload` before calling in.
 * A future optimization can short-circuit based on a cheap upstream
 * signal (like MAX(updated_at)); this helper is the bandwidth layer.
 */
export async function respondWithETag(
  request: Request,
  payload: unknown,
): Promise<NextResponse> {
  const etag = await etagForJson(payload);
  const inm = request.headers.get("if-none-match");

  // Browsers may send a weak ETag prefix (W/"..."); strip it before
  // comparing so a mid-cache hop doesn't force a full re-download.
  const strip = (v: string | null) => (v ? v.replace(/^W\//, "").trim() : null);
  if (strip(inm) === strip(etag)) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  }

  const res = NextResponse.json(payload);
  res.headers.set("ETag", etag);
  // `private`: per-user response, no shared-cache storage.
  // `max-age=0, must-revalidate`: browser can cache the body for
  //   replay on 304, but MUST send If-None-Match to revalidate on
  //   every reuse. That's exactly what we want — polling sends the
  //   conditional header automatically.
  res.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  return res;
}
