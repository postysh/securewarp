import "server-only";
import { getSession } from "./session";
import { supabase } from "@/lib/db/supabase";

export type AdminRole = "user" | "admin" | "owner";

export interface AdminContext {
  userId: string;
  email: string;
  role: AdminRole;
}

/**
 * Gate an API route on admin-or-owner role. Returns the session + role on
 * success. Returns null if:
 *   - there's no session
 *   - the user is suspended (getSession already blocks them, but we double-check)
 *   - the user's role is 'user' (not admin/owner)
 *
 * Caller pattern:
 *   const ctx = await requireAdmin();
 *   if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
 *
 * For owner-only routes (role changes, user deletion), check `ctx.role === 'owner'`
 * after this helper returns.
 */
export async function requireAdmin(): Promise<AdminContext | null> {
  const session = await getSession();
  if (!session) return null;

  const { data, error } = await supabase
    .from("users")
    .select("role, suspended_at")
    .eq("id", session.userId)
    .single();

  if (error || !data) return null;
  if (data.suspended_at) return null;
  if (data.role !== "admin" && data.role !== "owner") return null;

  return { userId: session.userId, email: session.email, role: data.role as AdminRole };
}

export interface AdminAuditInput {
  actorUserId: string;
  actorRole: AdminRole;
  action: string;
  targetUserId?: string | null;
  detail?: string | null;
}

/**
 * Append to the admin_audit log. Separate table from security_audit so admin
 * actions have their own immutable trail — never delete rows from here.
 */
export function adminAudit(input: AdminAuditInput): void {
  void supabase.from("admin_audit").insert({
    actor_user_id: input.actorUserId,
    actor_role: input.actorRole,
    action: input.action,
    target_user_id: input.targetUserId ?? null,
    detail: input.detail ?? null,
  });
}
