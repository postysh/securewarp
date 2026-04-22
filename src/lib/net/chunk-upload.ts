/**
 * Resilient chunk PUT — wraps the raw fetch(PUT) for R2 ciphertext
 * uploads with retry + presigned-URL refresh. Used by all three
 * upload paths (initial upload, new-version, rotate-and-revoke) so
 * transient R2 blips or a long-running upload hitting URL expiry
 * don't kill a multi-GB transfer.
 *
 * Retry policy:
 *   - Network error or 5xx: up to 3 attempts, exponential backoff
 *     1 s / 2 s / 4 s between them.
 *   - 403 (URL expired or signature invalid): call refreshUrl() once
 *     to get a fresh presigned URL, then retry from attempt 0 on the
 *     new URL. If the new URL also 403s, give up — something's
 *     actually wrong with permissions.
 *   - 4xx other than 403: give up immediately. Retry won't fix an
 *     auth/validation problem.
 *
 * Total worst-case duration on a single chunk: 3 retries × 4 s
 * backoff + 1 URL refresh → ~15 seconds. Per-chunk timeout is on
 * the fetch itself (browser default).
 */

interface RetryOptions {
  maxAttempts?: number;
  baseBackoffMs?: number;
  // When omitted (e.g. the rotate-and-revoke path, which has no
  // per-chunk refresh endpoint), a 403 is fatal — same as any
  // other 4xx.
  refreshUrl?: () => Promise<string>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number, base: number): number {
  return base * Math.pow(2, attempt);
}

/**
 * PUT ciphertext to an R2 presigned URL with retry + URL refresh.
 * Throws on final failure (caller treats as upload failure).
 */
export async function putChunkWithRetry(
  initialUrl: string,
  body: BodyInit,
  options: RetryOptions,
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseBackoff = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;

  let url = initialUrl;
  let urlRefreshed = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        method: "PUT",
        body,
        headers: { "Content-Type": "application/octet-stream" },
      });
    } catch (err) {
      if (attempt === maxAttempts - 1) throw err;
      await sleep(backoffMs(attempt, baseBackoff));
      continue;
    }

    if (res.ok) return;

    // 403: URL expired or signature drifted. Refresh once if the
    // caller provided a refresh function; otherwise treat as fatal.
    if (res.status === 403 && options.refreshUrl && !urlRefreshed) {
      url = await options.refreshUrl();
      urlRefreshed = true;
      // Don't count this attempt against the retry budget — the
      // prior attempts were under a stale URL.
      attempt = -1;
      continue;
    }

    // 5xx: transient. Back off and retry.
    if (res.status >= 500 && attempt < maxAttempts - 1) {
      await sleep(backoffMs(attempt, baseBackoff));
      continue;
    }

    // 4xx (other than refreshed 403) or exhausted retries on 5xx.
    throw new Error(`Chunk upload failed: ${res.status} ${res.statusText}`);
  }

  // Unreachable: the loop always returns or throws. Satisfies TS
  // exhaustiveness since the above `throw` is inside the loop.
  throw new Error("Chunk upload exhausted retries");
}
