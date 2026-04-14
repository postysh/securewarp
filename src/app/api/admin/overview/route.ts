import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Recent activity bundle for the Overview page:
 *   - latestSignups: 5 most recent users (email + created_at + role)
 *   - latestAdminActions: 5 most recent admin_audit rows with actor+target emails
 *   - signupsByDay: 14-day histogram of signup counts (for the chart)
 */
export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const [latestUsersQ, latestAdminQ, signupWindowQ] = await Promise.all([
      supabase
        .from("users")
        .select("id, email, role, created_at, suspended_at")
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("admin_audit")
        .select("id, occurred_at, action, actor_user_id, target_user_id, detail")
        .order("occurred_at", { ascending: false })
        .limit(5),
      supabase
        .from("users")
        .select("created_at")
        .gte("created_at", fourteenDaysAgo),
    ]);

    // Hydrate actor + target emails for admin actions
    const userIds = new Set<string>();
    for (const a of latestAdminQ.data ?? []) {
      if (a.actor_user_id) userIds.add(a.actor_user_id);
      if (a.target_user_id) userIds.add(a.target_user_id);
    }
    let emailById = new Map<string, string>();
    if (userIds.size > 0) {
      const { data: users } = await supabase.from("users").select("id, email").in("id", [...userIds]);
      for (const u of users ?? []) emailById.set(u.id, u.email);
    }

    // 14-day signup histogram — bucket by day in UTC.
    const buckets = new Map<string, number>();
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, 0);
    }
    for (const row of signupWindowQ.data ?? []) {
      const key = (row.created_at as string).slice(0, 10);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const signupsByDay = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, count]) => ({ day, count }));

    return NextResponse.json({
      latestSignups: (latestUsersQ.data ?? []).map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        createdAt: u.created_at,
        suspendedAt: u.suspended_at,
      })),
      latestAdminActions: (latestAdminQ.data ?? []).map((a) => ({
        id: a.id,
        occurredAt: a.occurred_at,
        action: a.action,
        actorEmail: a.actor_user_id ? emailById.get(a.actor_user_id) ?? null : null,
        targetEmail: a.target_user_id ? emailById.get(a.target_user_id) ?? null : null,
        detail: a.detail,
      })),
      signupsByDay,
    });
  } catch (err) {
    logError("admin.overview", err);
    return NextResponse.json({ error: "Failed to load overview" }, { status: 500 });
  }
}
