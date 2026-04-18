import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { polar } from "@/lib/billing/polar";
import { POLAR_EVENTS } from "@/lib/billing/config";
import {
  computeUsageForSubscribedUsers,
  toBillable,
  usageEventId,
} from "@/lib/billing/usage";
import { auditEventAwait } from "@/lib/audit";
import { safeCompare, utf8ToBytes } from "@/lib/auth/safe-compare";
import { logError } from "@/lib/log";

/**
 * Nightly usage aggregator → Polar. Computes each subscribed user's
 * storage GB, seat count, and workspace count, applies the free-tier
 * allowances, and emits one daily event per (user, meter) to Polar.
 *
 * Idempotency: Polar dedups events by external_id (`usage:<user>:<meter>:<date>`),
 * and we also skip users whose billing_usage_events already has a
 * row for today. Re-running the cron same-day is safe.
 *
 * Auth: Bearer CRON_SECRET. Matches the pattern established by
 * expire-trash — external schedulers (cron-job.org) hit POST.
 */

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) return false;
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  return safeCompare(utf8ToBytes(token), utf8ToBytes(expected));
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function run(): Promise<NextResponse> {
  const eventDate = todayUTC();
  let usersProcessed = 0;
  let eventsSent = 0;
  let skipped = 0;

  try {
    const users = await computeUsageForSubscribedUsers();

    for (const u of users) {
      usersProcessed++;
      const billable = toBillable(u);

      // Already sent today? Skip — keeps the run idempotent even if
      // Polar's dedup somehow drifts.
      const { data: existing } = await supabase
        .from("billing_usage_events")
        .select("meter_name")
        .eq("user_id", u.userId)
        .eq("event_date", eventDate);
      const sentToday = new Set((existing ?? []).map((r) => r.meter_name as string));

      const toSend = [
        { meter: POLAR_EVENTS.STORAGE_DAILY, field: "gb", value: billable.storageGB },
        { meter: POLAR_EVENTS.SEATS_DAILY, field: "seats", value: billable.seats },
        { meter: POLAR_EVENTS.WORKSPACES_DAILY, field: "workspaces", value: billable.workspaces },
      ].filter((e) => !sentToday.has(e.meter));

      if (toSend.length === 0) {
        skipped++;
        continue;
      }

      const events = toSend.map((e) => ({
        name: e.meter,
        customerId: u.polarCustomerId,
        externalId: usageEventId(u.userId, e.meter, eventDate),
        metadata: { [e.field]: e.value },
      }));

      try {
        await polar().events.ingest({ events });
      } catch (err) {
        logError("cron.usage-meter.ingest", err);
        continue; // next user; don't fail the whole run
      }

      // Record the audit rows. Upsert (unique on user+meter+date) so
      // a partial previous run's rows don't block this success path.
      await supabase
        .from("billing_usage_events")
        .upsert(
          toSend.map((e) => ({
            user_id: u.userId,
            meter_name: e.meter,
            quantity: e.value,
            event_date: eventDate,
            polar_event_id: usageEventId(u.userId, e.meter, eventDate),
          })),
          { onConflict: "user_id,meter_name,event_date" },
        );
      eventsSent += toSend.length;
    }

    await auditEventAwait({
      event: "cleanup.run",
      detail: `source=usage-meter users=${usersProcessed} events=${eventsSent} skipped=${skipped}`,
    });

    return NextResponse.json({
      usersProcessed,
      eventsSent,
      skipped,
      eventDate,
    });
  } catch (err) {
    logError("cron.usage-meter", err);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run();
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return run();
}
