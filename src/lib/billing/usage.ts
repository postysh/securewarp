import "server-only";
import { supabase } from "@/lib/db/supabase";
import { FREE_TIER } from "./config";

const BYTES_PER_GB = 1024 * 1024 * 1024;

export interface UserUsage {
  userId: string;
  polarCustomerId: string;
  storageGB: number;
  seats: number; // total including owner
  workspaces: number;
}

export interface BillableUsage {
  /** GB minus the free-tier allowance, clamped at 0. */
  storageGB: number;
  /** Non-owner seats (total distinct members across owned workspaces, minus 1). */
  seats: number;
  /** Workspaces beyond the first. */
  workspaces: number;
}

/**
 * Fetch every user with a live subscription row along with their
 * current usage totals. Run in the metering cron to decide what
 * events to emit.
 *
 * Storage is attributed to the file's owner, regardless of workspace.
 * Seats + workspaces are attributed to the workspace's owner.
 */
export async function computeUsageForSubscribedUsers(): Promise<UserUsage[]> {
  const { data: subs } = await supabase
    .from("billing_subscriptions")
    .select("user_id")
    .in("status", ["active", "trialing"]);
  if (!subs || subs.length === 0) return [];

  const userIds = Array.from(new Set(subs.map((s) => s.user_id as string)));

  const { data: customerRows } = await supabase
    .from("billing_customers")
    .select("user_id, polar_customer_id")
    .in("user_id", userIds);
  const polarByUser = new Map(
    (customerRows ?? []).map((r) => [
      r.user_id as string,
      r.polar_customer_id as string,
    ]),
  );

  const results: UserUsage[] = [];
  for (const userId of userIds) {
    const polarCustomerId = polarByUser.get(userId);
    if (!polarCustomerId) continue; // row missing — skip; webhook will backfill

    const [storage, seats, workspaces] = await Promise.all([
      computeStorageGB(userId),
      computeSeatCount(userId),
      computeWorkspaceCount(userId),
    ]);
    results.push({ userId, polarCustomerId, storageGB: storage, seats, workspaces });
  }
  return results;
}

async function computeStorageGB(userId: string): Promise<number> {
  // Supabase JS doesn't expose a sum() aggregate on the REST client;
  // we fetch raw size_bytes (paginated) and reduce in Node. Caps at
  // 10k rows — if a user has that many active files we still miss
  // the tail, but the metering cron runs daily so the underbill is
  // bounded. TODO: switch to a Postgres RPC if this ever bites.
  let total = 0;
  let from = 0;
  const pageSize = 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from("files")
      .select("size_bytes")
      .eq("owner_id", userId)
      .eq("upload_complete", true)
      .is("deleted_at", null)
      .range(from, from + pageSize - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    for (const row of data) total += (row.size_bytes as number) ?? 0;
    if (data.length < pageSize) break;
    from += pageSize;
    if (from >= 10000) break;
  }
  return total / BYTES_PER_GB;
}

async function computeSeatCount(userId: string): Promise<number> {
  // Distinct members across every workspace the user owns. The owner
  // counts as 1; that's handled in the billable conversion.
  const { data: wsRows } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId);
  const wsIds = (wsRows ?? []).map((w) => w.id as string);
  if (wsIds.length === 0) return 1; // just the owner

  const { data: members } = await supabase
    .from("workspace_members")
    .select("user_id")
    .in("workspace_id", wsIds);
  const distinct = new Set<string>((members ?? []).map((m) => m.user_id as string));
  distinct.add(userId); // owner is always a seat even if not in workspace_members
  return distinct.size;
}

async function computeWorkspaceCount(userId: string): Promise<number> {
  const { count } = await supabase
    .from("workspaces")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);
  return count ?? 0;
}

/**
 * Apply the free-tier allowances to a usage snapshot. Pro subscribers
 * still get the free-tier allowance — we bill only the overage.
 * Returning zero for a meter means skip sending that event today.
 */
export function toBillable(u: UserUsage): BillableUsage {
  return {
    storageGB: Math.max(0, u.storageGB - FREE_TIER.storageGB),
    seats: Math.max(0, u.seats - FREE_TIER.seats),
    workspaces: Math.max(0, u.workspaces - FREE_TIER.workspaces),
  };
}

/**
 * Canonical external_id for Polar event dedup. Re-running the cron
 * the same day with the same user+meter is a no-op on Polar's side.
 */
export function usageEventId(
  userId: string,
  meterName: string,
  dateISO: string,
): string {
  return `usage:${userId}:${meterName}:${dateISO}`;
}
