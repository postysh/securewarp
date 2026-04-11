import "server-only";
import { isDescendantOf, type AnonymousLinkPayload } from "@/lib/db/files";

/**
 * Every anonymous link route that serves a specific file ID (children
 * listing or download) must call this to verify the requested file is
 * actually within the link's scope. Without it a shared link to folder
 * A could be used as a bearer token to read folder B's contents.
 */
export async function assertLinkCovers(
  payload: AnonymousLinkPayload,
  targetFileId: string
): Promise<boolean> {
  if (payload.file.id === targetFileId) return true;
  if (!payload.file.is_folder) return false;
  return isDescendantOf(payload.file.id, targetFileId);
}

/**
 * Best-effort anonymous rate-limit key. Uses the Vercel-forwarded IP
 * when present, falls back to the X-Forwarded-For leftmost entry. The
 * key is intentionally coarse — it's defense-in-depth, not a security
 * boundary. UUID link IDs are 122-bit random so enumeration isn't the
 * threat we're protecting against.
 */
export function anonymousRateLimitKey(request: Request, suffix: string): string {
  const vercelIp = request.headers.get("x-vercel-forwarded-for");
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = (vercelIp ?? forwarded ?? "").split(",")[0].trim() || "anon";
  return `${suffix}:${ip}`;
}
