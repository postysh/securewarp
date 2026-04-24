import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import {
  getFilesForUser,
  getSharedWithUser,
  getCollaboratorsBulk,
  getInheritedChildren,
  getTrashedForUser,
  getStarredForUser,
  getRecentForUser,
  getAllAccessibleFiles,
  getEffectivePermission,
  type FileRowWithKey,
} from "@/lib/db/files";
import { recordFileAccess } from "@/lib/db/file-access";
import { supabase } from "@/lib/db/supabase";
import { respondWithETag } from "@/lib/http/etag";
import { logError } from "@/lib/log";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const shared = searchParams.get("shared") === "true";
    const trash = searchParams.get("trash") === "true";
    const starred = searchParams.get("starred") === "true";
    const recent = searchParams.get("recent") === "true";
    const all = searchParams.get("all") === "true";
    const includeWorkspaces = searchParams.get("includeWorkspaces") === "true";
    const parentId = searchParams.get("parentId") || null;
    const cursor = searchParams.get("cursor") || undefined;
    const workspaceId = searchParams.get("workspaceId") || null;

    let files: FileRowWithKey[];
    let nextCursor: string | null = null;

    if (all) {
      files = await getAllAccessibleFiles(session.userId, { includeWorkspaces });
    } else if (starred) {
      files = await getStarredForUser(session.userId);
    } else if (recent) {
      files = await getRecentForUser(session.userId);
    } else if (trash) {
      files = await getTrashedForUser(session.userId, workspaceId);
    } else if (shared) {
      files = await getSharedWithUser(session.userId);
    } else if (parentId === null) {
      const result = await getFilesForUser(session.userId, null, cursor);
      files = result.files;
      nextCursor = result.nextCursor;
    } else {
      files = await getInheritedChildren(parentId, session.userId);
      // Folder navigated into — bump its Recent stamp for this user.
      await recordFileAccess(session.userId, parentId);
    }

    // Enrich each file with collaborators, stars, and labels.
    // Run all three queries in parallel to minimize latency.
    const fileIds = files.map((f) => f.id);

    // Active-link probe — just returns file_ids that have at least one
    // public link still in force. No key material or link tokens ever
    // cross this boundary; the client only learns a boolean per file so
    // the "Public" badge can render in the Shared column. Kept as a
    // separate query (NOT a LIST_SELECT join) per the invariant that
    // file_keys and file_links must never be co-joined: they have
    // different wrap semantics and lifetimes.
    const nowIso = new Date().toISOString();
    const [collaboratorMap, starResult, labelResult, linksResult, seenResult] = await Promise.all([
      getCollaboratorsBulk(fileIds),
      supabase.from("user_stars").select("file_id").eq("user_id", session.userId).in("file_id", fileIds),
      supabase.from("file_labels").select("file_id, label_id, label:labels!file_labels_label_id_fkey(id, name, color, user_id)").in("file_id", fileIds),
      supabase
        .from("file_links")
        .select("file_id")
        .in("file_id", fileIds)
        .is("revoked_at", null)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`),
      // Per-user NEW-badge dismissal state. Lets a user who switches
      // browser or device keep files dismissed across their own
      // sessions — replaces the localStorage-only seen map.
      supabase
        .from("user_file_seen")
        .select("file_id, seen_at")
        .eq("user_id", session.userId)
        .in("file_id", fileIds),
    ]);

    const { data: starRows } = starResult;
    const { data: fileLabelRows } = labelResult;
    const { data: linkRows } = linksResult;
    const { data: seenRows } = seenResult;
    const starredSet = new Set((starRows || []).map((r) => r.file_id as string));
    const activeLinkSet = new Set((linkRows || []).map((r) => r.file_id as string));
    const seenAtMap = new Map(
      (seenRows || []).map((r) => [r.file_id as string, r.seen_at as string]),
    );
    const labelsByFile = new Map<string, { id: string; name: string; color: string }[]>();
    for (const row of (fileLabelRows || [])) {
      const fid = row.file_id as string;
      const label = (row.label as unknown) as { id: string; name: string; color: string; user_id?: string } | null;
      if (!label) continue;
      // Only include this user's labels — skip other users' labels on shared files
      if (label.user_id && label.user_id !== session.userId) continue;
      if (!labelsByFile.has(fid)) labelsByFile.set(fid, []);
      labelsByFile.get(fid)!.push(label);
    }

    // Resolve owner identity for workspace file lists
    const ownerIds = [...new Set(files.map((f) => f.owner_id))];
    const { data: ownerRows } = ownerIds.length > 0
      ? await supabase.from("users").select("id, email, display_name").in("id", ownerIds)
      : { data: [] };
    const ownerEmailMap = new Map((ownerRows || []).map((u) => [u.id, u.email as string]));
    const ownerNameMap = new Map(
      (ownerRows || []).map((u) => [u.id, (u.display_name as string | null) ?? null])
    );

    const enriched = files.map((f) => ({
      ...f,
      owner_email: ownerEmailMap.get(f.owner_id) ?? null,
      owner_display_name: ownerNameMap.get(f.owner_id) ?? null,
      is_starred: starredSet.has(f.id),
      has_active_link: activeLinkSet.has(f.id),
      seen_at: seenAtMap.get(f.id) ?? null,
      file_labels: labelsByFile.get(f.id) ?? [],
      collaborators: (collaboratorMap.get(f.id) ?? []).map((c) => ({
        userId: c.user_id,
        email: c.email,
        displayName: c.display_name,
        isOwner: c.is_owner,
        permissionLevel: c.permission_level,
      })),
    }));

    // Include the caller's effective permission on the current folder
    // so the client can hide write actions for viewers.
    // In workspace context, use the workspace membership role (admin/editor/viewer)
    // since file_keys permission doesn't distinguish admin from editor.
    let callerPermission: string | null = null;
    if (parentId) {
      // Check if this folder belongs to a workspace
      const { data: parentFile } = await supabase
        .from("files")
        .select("workspace_id")
        .eq("id", parentId)
        .single();
      if (parentFile?.workspace_id) {
        const { data: wsMem } = await supabase
          .from("workspace_members")
          .select("role")
          .eq("workspace_id", parentFile.workspace_id)
          .eq("user_id", session.userId)
          .single();
        callerPermission = wsMem?.role ?? null;
      } else {
        callerPermission = await getEffectivePermission(parentId, session.userId);
      }
    }

    // Conditional response. When the list hasn't changed since the
    // client's last poll the body hash matches and we return 304 —
    // saves 5-50KB of egress per poll, which dominates the cost line
    // at 1k+ users.
    return respondWithETag(request, { files: enriched, callerPermission, nextCursor });
  } catch (err) {
    logError("files.list", err);
    return NextResponse.json({ error: "Failed to list files" }, { status: 500 });
  }
}
