import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * GET /api/workspaces/stats?workspaceId=<uuid>
 *
 * Returns an at-a-glance summary for the Workspace Settings "Admin
 * overview" block. Any member (not just admins) can read it — the
 * numbers contain no secrets beyond what the member already sees
 * browsing the workspace. The app-layer `.eq("user_id",
 * session.userId)` membership filter is load-bearing because the
 * service-role client bypasses RLS.
 *
 * Returned shape:
 *   fileCount       — count of upload_complete, non-deleted, non-folder
 *                     rows in this workspace
 *   totalBytes      — SUM(size_bytes) of the same set
 *   memberCount     — rows on workspace_members
 *   lastActivityAt  — MAX(updated_at) on workspace files, a good
 *                     proxy for "something happened here recently"
 *                     without scanning the audit log
 */
const QuerySchema = z.object({ workspaceId: z.string().uuid() });

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      workspaceId: searchParams.get("workspaceId"),
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }
    const workspaceId = parsed.data.workspaceId;

    // Membership gate — service role bypasses RLS so this check
    // is the only thing preventing cross-workspace stat reads.
    const { data: mem } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.userId)
      .single();
    if (!mem) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }

    // Run the aggregate queries in parallel — each is cheap on
    // its own, combined they complete in the slowest one's time
    // instead of serial round-trips.
    const [filesRes, memberCountRes, lastActivityRes, workspaceRes] = await Promise.all([
      supabase
        .from("files")
        .select("size_bytes", { count: "exact" })
        .eq("workspace_id", workspaceId)
        .eq("upload_complete", true)
        .is("deleted_at", null)
        .eq("is_folder", false),
      supabase
        .from("workspace_members")
        .select("*", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
      supabase
        .from("files")
        .select("updated_at")
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("workspaces")
        .select(
          "created_at, require_2fa, links_disabled, links_require_password, links_max_expiry_days, " +
            "owner:users!workspaces_owner_id_fkey(email, display_name)",
        )
        .eq("id", workspaceId)
        .single(),
    ]);

    if (filesRes.error) throw filesRes.error;
    if (memberCountRes.error) throw memberCountRes.error;
    // lastActivityRes.error is OK — empty workspace yields no row.

    const files = filesRes.data ?? [];
    const fileCount = filesRes.count ?? files.length;
    const totalBytes = files.reduce(
      (sum, f) => sum + (Number(f.size_bytes) || 0),
      0,
    );

    const wsRow = (workspaceRes.data as unknown) as {
      created_at: string;
      require_2fa: boolean;
      links_disabled: boolean;
      links_require_password: boolean;
      links_max_expiry_days: number | null;
      owner: { email: string; display_name: string | null } | null;
    } | null;

    return NextResponse.json({
      fileCount,
      totalBytes,
      memberCount: memberCountRes.count ?? 0,
      lastActivityAt: (lastActivityRes.data?.updated_at as string | null) ?? null,
      // Banner fields — the owner's plaintext email + display_name
      // are already surfaced elsewhere in the app (sharer identity,
      // workspace switcher); surfacing them here for the Overview
      // banner adds no new PII.
      createdAt: wsRow?.created_at ?? null,
      ownerEmail: wsRow?.owner?.email ?? null,
      ownerDisplayName: wsRow?.owner?.display_name ?? null,
      // Security policy — returned so the Settings modal always
      // shows the DB's current state even when the parent only
      // passed a partial `workspace` prop. The Security tab + the
      // Overview posture card both read from this payload rather
      // than trusting prop drilling.
      require2fa: wsRow?.require_2fa ?? false,
      linksDisabled: wsRow?.links_disabled ?? false,
      linksRequirePassword: wsRow?.links_require_password ?? false,
      linksMaxExpiryDays: wsRow?.links_max_expiry_days ?? null,
    });
  } catch (err) {
    logError("workspaces.stats", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
