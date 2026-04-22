/**
 * In-memory LRU cache of decrypted file Blobs for the preview flow.
 *
 * Why it exists: `previewFile` in `use-files.ts` re-fetches every
 * chunk from R2 and re-decrypts on every open. For a multi-GB video,
 * re-opening within a session costs the user another full decrypt +
 * network pull. The cache stores the already-decrypted Blob so the
 * second open returns in a few milliseconds.
 *
 * Zero-knowledge rails (see AGENTS.md lock-cache section for the
 * pattern we're mirroring):
 *   - Lives in process memory only. Never serialized, never written
 *     to disk, never sent anywhere.
 *   - Cleared on `keys` identity change (login swap) and on hook
 *     unmount — same policy as folderPrivHierCache.
 *   - Invalidated per-file on new version, rotation, restore, or
 *     delete so a user never sees stale or post-revoke content.
 *   - Blob content is plaintext. CLAUDE.md only mandates zeroing
 *     for key material (session keys, priv hier keys), not for
 *     plaintext content — content already exists in memory while a
 *     preview is open, and caching is a UX decision, not a ZK
 *     regression.
 *
 * Budget: a hard cap on the SUM of cached blob sizes. Entries
 * larger than the budget aren't cached at all (they'd evict
 * everything else to fit and then immediately exceed anyway).
 */

interface CacheEntry {
  blob: Blob;
  name: string; // Original plaintext name from decrypted metadata.
  mime: string; // Original MIME — caller picks render branch; the
  // blobUrl itself always carries the safe-coerced MIME.
  size: number;
  lastAccessedAt: number;
}

// 2 GB. Balances "I just watched a 500 MB video, re-opening should
// be instant" against "we shouldn't starve the browser on a low-RAM
// device." A 4 GB laptop has ~1–2 GB free for tabs; 2 GB is the
// most we can claim without risking OOM on constrained machines.
// Chrome caps a single tab around 4 GB anyway — we'd be rejected
// allocating more regardless.
const DEFAULT_BUDGET_BYTES = 2 * 1024 * 1024 * 1024;

export interface PreviewCacheOptions {
  budgetBytes?: number;
}

export function createPreviewCache(options: PreviewCacheOptions = {}) {
  const budget = options.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  const map = new Map<string, CacheEntry>();
  let totalBytes = 0;

  function get(fileId: string): CacheEntry | undefined {
    const entry = map.get(fileId);
    if (!entry) return undefined;
    // Touch for LRU ordering. Map iteration order reflects insertion
    // order, so re-insert on hit to keep the most-recent-use entry
    // at the tail and the oldest at the head.
    map.delete(fileId);
    entry.lastAccessedAt = Date.now();
    map.set(fileId, entry);
    return entry;
  }

  function set(
    fileId: string,
    value: { blob: Blob; name: string; mime: string },
  ): void {
    const size = value.blob.size;

    // Too large to cache. Don't bother evicting the rest to make
    // room — we'd just evict everything and then fail to fit.
    if (size > budget) return;

    // If key already present, remove it first so the size bookkeeping
    // doesn't double-count.
    const existing = map.get(fileId);
    if (existing) {
      totalBytes -= existing.size;
      map.delete(fileId);
    }

    // Evict LRU entries until the new one fits.
    while (totalBytes + size > budget && map.size > 0) {
      const oldestKey = map.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = map.get(oldestKey);
      if (oldest) {
        totalBytes -= oldest.size;
        map.delete(oldestKey);
      }
    }

    map.set(fileId, {
      blob: value.blob,
      name: value.name,
      mime: value.mime,
      size,
      lastAccessedAt: Date.now(),
    });
    totalBytes += size;
  }

  function invalidate(fileId: string): void {
    const entry = map.get(fileId);
    if (!entry) return;
    totalBytes -= entry.size;
    map.delete(fileId);
  }

  function clear(): void {
    map.clear();
    totalBytes = 0;
  }

  // Introspection — useful for tests and for a future "clear cache"
  // settings toggle if we ever expose one.
  function stats() {
    return { entryCount: map.size, totalBytes, budgetBytes: budget };
  }

  return { get, set, invalidate, clear, stats };
}

export type PreviewCache = ReturnType<typeof createPreviewCache>;
