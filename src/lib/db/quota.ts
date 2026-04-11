import "server-only";
import { supabase } from "./supabase";

export const MAX_STORAGE_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB

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

export async function assertWithinQuota(userId: string, incomingBytes: number): Promise<void> {
  const used = await getUsedBytes(userId);
  if (used + incomingBytes > MAX_STORAGE_BYTES) {
    const err = new Error("Storage quota exceeded") as Error & { status?: number };
    err.status = 413;
    throw err;
  }
}
