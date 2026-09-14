import "server-only";
import { supabase } from "./supabase";
import { getEntitlements } from "@/lib/billing/customers";

export const MAX_FILE_COUNT = 10_000; // per user — abuse guard, not a billing knob
/** Exported for UI helpers that need the free-tier default. */
export const FREE_TIER_STORAGE_BYTES = 20 * 1024 * 1024 * 1024;

export async function getUsedBytes(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("files")
    .select("size_bytes")
    .eq("owner_id", userId);

  if (error) throw new Error(`Failed to read usage: ${error.message}`);
  return (data || []).reduce(
    (sum: number, f: { size_bytes: number | null }) => sum + (f.size_bytes || 0),
    0
  );
}

export async function getFileCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("files")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);
  if (error) throw new Error(`Failed to count files: ${error.message}`);
  return count ?? 0;
}

export interface QuotaCheckOptions {
  /**
   * The file whose CURRENT `files.size_bytes` the incoming bytes will
   * replace. Used at finalize / rotate-commit, where the row already
   * exists (with the client-declared or previous-version size) and is
   * therefore already counted in `getUsedBytes`. Without this the
   * measured size would be double-counted against the cap.
   */
  replacesFileId?: string;
  /**
   * Skip the 10k-file abuse guard. Set at finalize, where the row was
   * created (and counted) at init — re-checking would reject the last
   * legitimately-initialised file.
   */
  skipFileCount?: boolean;
}

export async function assertWithinQuota(
  userId: string,
  incomingBytes: number,
  opts: QuotaCheckOptions = {},
): Promise<void> {
  // Each tier has a hard storage cap (see TIER_LIMITS). Free = 20 GB,
  // Plus = 500 GB, Pro = 2 TB. Admins can override the cap per-user
  // for custom deals — see `getEntitlements`. The 10k-file abuse guard
  // applies across every tier regardless of plan.
  //
  // `incomingBytes` at init is the client's declaration (a fast, cheap
  // pre-check); at finalize it is the size the server MEASURED in R2.
  // Only the latter is authoritative — see `measureBlobSizes`.
  const [usedRaw, count, ent, replaced] = await Promise.all([
    getUsedBytes(userId),
    opts.skipFileCount ? Promise.resolve(0) : getFileCount(userId),
    getEntitlements(userId),
    opts.replacesFileId ? getFileSizeBytes(opts.replacesFileId, userId) : Promise.resolve(0),
  ]);
  const used = Math.max(0, usedRaw - replaced);
  if (incomingBytes > ent.maxFileSizeBytes) {
    const err = new Error(
      `File too large. ${ent.tierLabel} plan allows up to ${formatBytes(ent.maxFileSizeBytes)} per file.`,
    ) as Error & { status?: number };
    err.status = 413;
    throw err;
  }
  const capBytes = ent.storageGB * 1024 * 1024 * 1024;
  if (used + incomingBytes > capBytes) {
    const err = new Error("Storage quota exceeded") as Error & { status?: number };
    err.status = 413;
    throw err;
  }
  if (!opts.skipFileCount && count >= MAX_FILE_COUNT) {
    const err = new Error("File count limit reached (10,000)") as Error & { status?: number };
    err.status = 413;
    throw err;
  }
}

async function getFileSizeBytes(fileId: string, ownerId: string): Promise<number> {
  const { data } = await supabase
    .from("files")
    .select("size_bytes")
    .eq("id", fileId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  return (data?.size_bytes as number | null) ?? 0;
}

function formatBytes(bytes: number): string {
  const GB = 1024 * 1024 * 1024;
  const MB = 1024 * 1024;
  if (bytes >= GB) {
    const val = bytes / GB;
    return `${Number.isInteger(val) ? val : val.toFixed(1)} GB`;
  }
  return `${Math.round(bytes / MB)} MB`;
}
