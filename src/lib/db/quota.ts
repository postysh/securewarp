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

export async function assertWithinQuota(userId: string, incomingBytes: number): Promise<void> {
  // Each tier has a hard storage cap (see TIER_LIMITS). Free = 20 GB,
  // Plus = 500 GB, Pro = 2 TB. Admins can override the cap per-user
  // for custom deals — see `getEntitlements`. The 10k-file abuse guard
  // applies across every tier regardless of plan.
  const [used, count, ent] = await Promise.all([
    getUsedBytes(userId),
    getFileCount(userId),
    getEntitlements(userId),
  ]);
  const capBytes = ent.storageGB * 1024 * 1024 * 1024;
  if (used + incomingBytes > capBytes) {
    const err = new Error("Storage quota exceeded") as Error & { status?: number };
    err.status = 413;
    throw err;
  }
  if (count >= MAX_FILE_COUNT) {
    const err = new Error("File count limit reached (10,000)") as Error & { status?: number };
    err.status = 413;
    throw err;
  }
}
