import "server-only";

/**
 * Structured server-side error logger. Records the error type, message, and
 * a short context tag but never request payloads or crypto material. Swallows
 * nothing — callers decide how to respond.
 */
export function logError(context: string, err: unknown): void {
  const e = err as { name?: string; code?: string | number; message?: string };
  const payload = {
    ctx: context,
    name: e?.name ?? "Error",
    code: e?.code,
    message: typeof e?.message === "string" ? e.message : String(err),
  };
  // eslint-disable-next-line no-console
  console.error(JSON.stringify(payload));
}
