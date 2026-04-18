import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getLatestSubscription, getTier } from "@/lib/billing/customers";
import { syncLatestSubscriptionFor } from "@/lib/billing/sync";
import { supabase } from "@/lib/db/supabase";
import { TIER_LIMITS, limitsForTier, type Tier } from "@/lib/billing/config";
import { logError } from "@/lib/log";

const BYTES_PER_GB = 1024 * 1024 * 1024;

/**
 * Plan + usage summary for the caller. Drives the Plan & billing
 * panel and tier picker. Single endpoint so the UI doesn't need to
 * fan-out three requests to know what plan the user is on.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Pull latest state from Stripe before reading local rows.
    // Makes the panel converge to the correct tier within one poll
    // iteration even when webhook delivery is unavailable (dev) or
    // delayed (production reconciliation).
    try { await syncLatestSubscriptionFor(session.userId); }
    catch (e) { logError("billing.status.sync", e); }

    const [tier, subscription, storageBytes, seats, workspaces] = await Promise.all([
      getTier(session.userId),
      getLatestSubscription(session.userId),
      getStorageBytes(session.userId),
      getSeatCount(session.userId),
      getWorkspaceCount(session.userId),
    ]);
    const limits = limitsForTier(tier);

    return NextResponse.json({
      tier,
      subscription: subscription
        ? { status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd }
        : null,
      usage: {
        storageGB: storageBytes / BYTES_PER_GB,
        storageBytes,
        seats,
        workspaces,
      },
      limits: {
        storageGB: limits.storageGB,
        seats: limits.seats === Infinity ? null : limits.seats,
        workspaces: limits.workspaces === Infinity ? null : limits.workspaces,
        priceCents: limits.priceCents,
        label: limits.label,
      },
      tiers: Object.entries(TIER_LIMITS).map(([id, l]) => ({
        id: id as Tier,
        label: l.label,
        priceCents: l.priceCents,
        storageGB: l.storageGB,
        seats: l.seats === Infinity ? null : l.seats,
        workspaces: l.workspaces === Infinity ? null : l.workspaces,
      })),
    });
  } catch (err) {
    logError("billing.status", err);
    return NextResponse.json({ error: "Failed to load plan" }, { status: 500 });
  }
}

async function getStorageBytes(userId: string): Promise<number> {
  let total = 0;
  let from = 0;
  const pageSize = 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data } = await supabase
      .from("files")
      .select("size_bytes")
      .eq("owner_id", userId)
      .eq("upload_complete", true)
      .is("deleted_at", null)
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    for (const row of data) total += (row.size_bytes as number) ?? 0;
    if (data.length < pageSize) break;
    from += pageSize;
    if (from >= 10000) break;
  }
  return total;
}

async function getSeatCount(userId: string): Promise<number> {
  const { data: wsRows } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", userId);
  const wsIds = (wsRows ?? []).map((w) => w.id as string);
  if (wsIds.length === 0) return 1;
  const { data: members } = await supabase
    .from("workspace_members")
    .select("user_id")
    .in("workspace_id", wsIds);
  const distinct = new Set<string>((members ?? []).map((m) => m.user_id as string));
  distinct.add(userId);
  return distinct.size;
}

async function getWorkspaceCount(userId: string): Promise<number> {
  const { count } = await supabase
    .from("workspaces")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);
  return count ?? 0;
}
