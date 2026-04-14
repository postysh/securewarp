import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const PAGE_SIZE = 25;

/**
 * Paginated users list for the admin UI.
 *
 * Query params:
 *   - search: substring match on email (case-insensitive)
 *   - cursor: offset (numeric). Absent = first page.
 *
 * Returns: { users, total, nextCursor }
 *
 * Each user row includes aggregated file count + storage bytes. Computed
 * per-user via a correlated sub-query is cheap at this scale; swap for a
 * materialized view if it ever slows down.
 */
export async function GET(request: Request) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.trim() ?? "";
    const cursor = Number(url.searchParams.get("cursor") ?? "0");
    const offset = Number.isFinite(cursor) && cursor >= 0 ? cursor : 0;

    let usersQuery = supabase
      .from("users")
      .select("id, email, role, created_at, last_login_at, suspended_at, suspended_reason", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (search) {
      usersQuery = usersQuery.ilike("email", `%${search}%`);
    }

    const { data: users, error, count } = await usersQuery;
    if (error) throw error;

    // Attach storage usage + file count per user. Batched into a single
    // query by grouping on owner_id.
    const userIds = (users ?? []).map((u) => u.id);
    let usageById = new Map<string, { bytes: number; files: number }>();

    if (userIds.length > 0) {
      const { data: files } = await supabase
        .from("files")
        .select("owner_id, size_bytes")
        .in("owner_id", userIds)
        .eq("upload_complete", true)
        .is("deleted_at", null);

      for (const f of files ?? []) {
        const row = usageById.get(f.owner_id) ?? { bytes: 0, files: 0 };
        row.bytes += f.size_bytes || 0;
        row.files += 1;
        usageById.set(f.owner_id, row);
      }
    }

    const rows = (users ?? []).map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role as "user" | "admin" | "owner",
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at,
      suspendedAt: u.suspended_at,
      suspendedReason: u.suspended_reason,
      storageBytes: usageById.get(u.id)?.bytes ?? 0,
      fileCount: usageById.get(u.id)?.files ?? 0,
    }));

    const total = count ?? 0;
    const nextCursor = offset + PAGE_SIZE < total ? offset + PAGE_SIZE : null;

    return NextResponse.json({ users: rows, total, nextCursor });
  } catch (err) {
    logError("admin.users.list", err);
    return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
  }
}
