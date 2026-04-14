import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Full single-user profile for the admin detail page.
 *
 * Returns everything an admin might need to look at for a specific user:
 *   - identity: email, role, created, last login, suspended state
 *   - usage: total storage bytes, file count (excluding trashed)
 *   - sessions: active session rows (jti, expires_at) for revocation UX
 *   - audit: most recent security_audit rows where this user was the
 *     actor OR the target, merged and time-sorted
 *   - notes: admin_notes attached to this user
 *
 * Zero-knowledge guardrail: no filenames, no content, no keys. Only
 * metadata the server already holds.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: userId } = await params;

    const [userQ, filesQ, sessionsQ, auditActorQ, auditTargetQ, notesQ] = await Promise.all([
      supabase
        .from("users")
        .select("id, email, role, created_at, last_login_at, suspended_at, suspended_reason")
        .eq("id", userId)
        .single(),
      supabase
        .from("files")
        .select("size_bytes, is_folder, deleted_at, upload_complete")
        .eq("owner_id", userId),
      supabase
        .from("sessions")
        .select("jti, user_id, expires_at")
        .eq("user_id", userId)
        .gt("expires_at", new Date().toISOString())
        .order("expires_at", { ascending: false })
        .limit(20),
      supabase
        .from("security_audit")
        .select("id, occurred_at, event_type, actor_user_id, target_user_id, target_file_id, detail")
        .eq("actor_user_id", userId)
        .order("occurred_at", { ascending: false })
        .limit(50),
      supabase
        .from("security_audit")
        .select("id, occurred_at, event_type, actor_user_id, target_user_id, target_file_id, detail")
        .eq("target_user_id", userId)
        .order("occurred_at", { ascending: false })
        .limit(50),
      supabase
        .from("admin_notes")
        .select("id, created_at, author_user_id, author_email, body")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (userQ.error || !userQ.data) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Storage aggregates — count only completed, non-deleted, non-folder rows.
    const liveFiles = (filesQ.data ?? []).filter(
      (f) => f.upload_complete && !f.deleted_at && !f.is_folder
    );
    const trashedFiles = (filesQ.data ?? []).filter(
      (f) => f.upload_complete && f.deleted_at && !f.is_folder
    );
    const totalBytes = liveFiles.reduce((s, f) => s + (f.size_bytes || 0), 0);
    const trashedBytes = trashedFiles.reduce((s, f) => s + (f.size_bytes || 0), 0);

    // Merge actor + target audit lists, dedupe by id, keep newest 50.
    const seen = new Set<number>();
    const audit = [...(auditActorQ.data ?? []), ...(auditTargetQ.data ?? [])]
      .filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      })
      .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
      .slice(0, 50);

    return NextResponse.json({
      user: {
        id: userQ.data.id,
        email: userQ.data.email,
        role: userQ.data.role,
        createdAt: userQ.data.created_at,
        lastLoginAt: userQ.data.last_login_at,
        suspendedAt: userQ.data.suspended_at,
        suspendedReason: userQ.data.suspended_reason,
      },
      usage: {
        totalBytes,
        fileCount: liveFiles.length,
        trashedBytes,
        trashedCount: trashedFiles.length,
      },
      sessions: (sessionsQ.data ?? []).map((s) => ({
        jti: s.jti,
        expiresAt: s.expires_at,
      })),
      audit,
      notes: notesQ.data ?? [],
    });
  } catch (err) {
    logError("admin.users.detail", err);
    return NextResponse.json({ error: "Failed to load user" }, { status: 500 });
  }
}
