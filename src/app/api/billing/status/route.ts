import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getLatestSubscription } from "@/lib/billing/customers";
import {
  computeUsageForSubscribedUsers,
  toBillable,
} from "@/lib/billing/usage";
import { supabase } from "@/lib/db/supabase";
import { FREE_TIER, POLAR_UNIT_CENTS } from "@/lib/billing/config";
import { logError } from "@/lib/log";

const BYTES_PER_GB = 1024 * 1024 * 1024;

/**
 * Plan + usage summary for the caller. Drives the settings Plan tab.
 * Returns the same usage totals we'd bill for if the user is on Pro,
 * so users can preview the cost before upgrading.
 *
 * Free-tier users see their current consumption plus the allowance
 * ratio (e.g. "3.2 / 20 GB"). Pro users see total consumption +
 * estimated monthly bill in cents.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const subscription = await getLatestSubscription(session.userId);
    const isPaid =
      !!subscription &&
      (subscription.status === "active" || subscription.status === "trialing") &&
      (!subscription.currentPeriodEnd ||
        new Date(subscription.currentPeriodEnd).getTime() > Date.now());

    // Usage — we intentionally recompute for THIS user only rather
    // than calling computeUsageForSubscribedUsers (which is the cron
    // aggregator over all paying users). Inline versions here mirror
    // that helper's queries; if they drift, fix both.
    const [storageBytes, seats, workspaces] = await Promise.all([
      getStorageBytes(session.userId),
      getSeatCount(session.userId),
      getWorkspaceCount(session.userId),
    ]);
    const storageGB = storageBytes / BYTES_PER_GB;

    const usage = { storageGB, seats, workspaces };
    const billable = toBillable({
      userId: session.userId,
      polarCustomerId: "",
      ...usage,
    });
    const estimatedMonthlyCents =
      billable.storageGB * POLAR_UNIT_CENTS.STORAGE_PER_GB_MONTH +
      billable.seats * POLAR_UNIT_CENTS.SEAT_PER_MONTH +
      billable.workspaces * POLAR_UNIT_CENTS.WORKSPACE_PER_MONTH;

    return NextResponse.json({
      plan: isPaid ? "pro" : "free",
      subscription: subscription
        ? {
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
          }
        : null,
      usage,
      allowance: {
        storageGB: FREE_TIER.storageGB,
        seats: FREE_TIER.seats,
        workspaces: FREE_TIER.workspaces,
      },
      billable,
      estimatedMonthlyCents,
      unitCents: {
        storagePerGB: POLAR_UNIT_CENTS.STORAGE_PER_GB_MONTH,
        seat: POLAR_UNIT_CENTS.SEAT_PER_MONTH,
        workspace: POLAR_UNIT_CENTS.WORKSPACE_PER_MONTH,
      },
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

// We re-export this symbol only to keep the import side-effect-free in
// case other modules later need the same helper. Silences an unused-
// import TS warning without actually exposing internals.
void computeUsageForSubscribedUsers;
