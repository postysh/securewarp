import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const PAGE_SIZE = 50;

/**
 * Combined audit log: returns recent entries from both `security_audit`
 * (user actions) and `admin_audit` (admin actions), merged and sorted.
 *
 * Query params:
 *   - source: "all" | "security" | "admin" (default: "all")
 *   - cursor: ISO timestamp — return entries older than this
 *   - q: free-text filter (matches event type, action, or detail)
 */
export async function GET(request: Request) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const url = new URL(request.url);
    const source = url.searchParams.get("source") ?? "all";
    const cursor = url.searchParams.get("cursor");
    const q = url.searchParams.get("q")?.trim() ?? "";

    const wantSecurity = source === "all" || source === "security";
    const wantAdmin = source === "all" || source === "admin";

    const [securityQ, adminQ] = await Promise.all([
      wantSecurity ? (() => {
        let query = supabase
          .from("security_audit")
          .select("id, occurred_at, event_type, actor_user_id, target_user_id, target_file_id, detail")
          .order("occurred_at", { ascending: false })
          .limit(PAGE_SIZE);
        if (cursor) query = query.lt("occurred_at", cursor);
        if (q) query = query.or(`event_type.ilike.%${q}%,detail.ilike.%${q}%`);
        return query;
      })() : Promise.resolve({ data: [], error: null }),
      wantAdmin ? (() => {
        let query = supabase
          .from("admin_audit")
          .select("id, occurred_at, actor_user_id, actor_role, action, target_user_id, detail")
          .order("occurred_at", { ascending: false })
          .limit(PAGE_SIZE);
        if (cursor) query = query.lt("occurred_at", cursor);
        if (q) query = query.or(`action.ilike.%${q}%,detail.ilike.%${q}%`);
        return query;
      })() : Promise.resolve({ data: [], error: null }),
    ]);

    if (securityQ.error) throw securityQ.error;
    if (adminQ.error) throw adminQ.error;

    type Entry = {
      kind: "security" | "admin";
      id: string;
      occurredAt: string;
      event: string;
      actorUserId: string | null;
      targetUserId: string | null;
      actorRole?: string;
      detail: string | null;
    };

    const merged: Entry[] = [
      ...(securityQ.data ?? []).map((r): Entry => ({
        kind: "security",
        id: `sec-${r.id}`,
        occurredAt: r.occurred_at,
        event: r.event_type,
        actorUserId: r.actor_user_id,
        targetUserId: r.target_user_id,
        detail: r.detail,
      })),
      ...(adminQ.data ?? []).map((r): Entry => ({
        kind: "admin",
        id: `adm-${r.id}`,
        occurredAt: r.occurred_at,
        event: r.action,
        actorUserId: r.actor_user_id,
        actorRole: r.actor_role,
        targetUserId: r.target_user_id,
        detail: r.detail,
      })),
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, PAGE_SIZE);

    // Batch-hydrate actor + target emails so the UI can render them inline.
    const userIds = new Set<string>();
    for (const e of merged) {
      if (e.actorUserId) userIds.add(e.actorUserId);
      if (e.targetUserId) userIds.add(e.targetUserId);
    }
    let emailById = new Map<string, string>();
    if (userIds.size > 0) {
      const { data: users } = await supabase.from("users").select("id, email").in("id", [...userIds]);
      for (const u of users ?? []) emailById.set(u.id, u.email);
    }

    const rows = merged.map((e) => ({
      ...e,
      actorEmail: e.actorUserId ? emailById.get(e.actorUserId) ?? null : null,
      targetEmail: e.targetUserId ? emailById.get(e.targetUserId) ?? null : null,
    }));

    const nextCursor = rows.length === PAGE_SIZE ? rows[rows.length - 1].occurredAt : null;

    return NextResponse.json({ entries: rows, nextCursor });
  } catch (err) {
    logError("admin.audit", err);
    return NextResponse.json({ error: "Failed to load audit log" }, { status: 500 });
  }
}
