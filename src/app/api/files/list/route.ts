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
import { supabase } from "@/lib/db/supabase";
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
    const parentId = searchParams.get("parentId") || null;
    const cursor = searchParams.get("cursor") || undefined;

    let files: FileRowWithKey[];
    let nextCursor: string | null = null;

    if (all) {
      files = await getAllAccessibleFiles(session.userId);
    } else if (starred) {
      files = await getStarredForUser(session.userId);
    } else if (recent) {
      files = await getRecentForUser(session.userId);
    } else if (trash) {
      files = await getTrashedForUser(session.userId);
    } else if (shared) {
      files = await getSharedWithUser(session.userId);
    } else if (parentId === null) {
      const result = await getFilesForUser(session.userId, null, cursor);
      files = result.files;
      nextCursor = result.nextCursor;
    } else {
      files = await getInheritedChildren(parentId, session.userId);
    }

    // Enrich each file with collaborators, stars, and labels.
    // Run all three queries in parallel to minimize latency.
    const fileIds = files.map((f) => f.id);

    const [collaboratorMap, starResult, labelResult] = await Promise.all([
      getCollaboratorsBulk(fileIds),
      supabase.from("user_stars").select("file_id").eq("user_id", session.userId).in("file_id", fileIds),
      supabase.from("file_labels").select("file_id, label_id, label:labels!file_labels_label_id_fkey(id, name, color, user_id)").in("file_id", fileIds),
    ]);

    const { data: starRows } = starResult;
    const { data: fileLabelRows } = labelResult;
    const starredSet = new Set((starRows || []).map((r) => r.file_id as string));
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

    // Resolve owner emails for workspace file lists
    const ownerIds = [...new Set(files.map((f) => f.owner_id))];
    const { data: ownerRows } = ownerIds.length > 0
      ? await supabase.from("users").select("id, email").in("id", ownerIds)
      : { data: [] };
    const ownerEmailMap = new Map((ownerRows || []).map((u) => [u.id, u.email as string]));

    const enriched = files.map((f) => ({
      ...f,
      owner_email: ownerEmailMap.get(f.owner_id) ?? null,
      is_starred: starredSet.has(f.id),
      file_labels: labelsByFile.get(f.id) ?? [],
      collaborators: (collaboratorMap.get(f.id) ?? []).map((c) => ({
        userId: c.user_id,
        email: c.email,
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

    return NextResponse.json({ files: enriched, callerPermission, nextCursor });
  } catch (err) {
    logError("files.list", err);
    return NextResponse.json({ error: "Failed to list files" }, { status: 500 });
  }
}
