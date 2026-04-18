import "server-only";
import { supabase } from "./supabase";
import { hasActiveSubscription } from "@/lib/billing/customers";

export const MAX_STORAGE_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB
export const MAX_FILE_COUNT = 10_000; // per user — abuse guard, not a billing knob

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
  // Storage cap only applies to the free tier. Pro subscribers pay
  // per GB — no hard wall, usage is billed via the nightly meter
  // cron. We still enforce the 10k-file abuse guard for everyone.
  const [used, count, paid] = await Promise.all([
    getUsedBytes(userId),
    getFileCount(userId),
    hasActiveSubscription(userId),
  ]);
  if (!paid && used + incomingBytes > MAX_STORAGE_BYTES) {
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
