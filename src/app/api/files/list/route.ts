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

    let files: FileRowWithKey[];
    if (all) {
      // Search index — all files the user can access, flat.
      files = await getAllAccessibleFiles(session.userId);
    } else if (starred) {
      files = await getStarredForUser(session.userId);
    } else if (recent) {
      // Recent: same as own-files root but sorted by updated_at desc,
      // limited to 50 most recent across all folders.
      files = await getRecentForUser(session.userId);
    } else if (trash) {
      // Flat top-of-trash view. Only surfaces roots — if the user
      // trashed a folder, its recursively-marked children stay
      // hidden behind it.
      files = await getTrashedForUser(session.userId);
    } else if (shared) {
      // Flat "Shared with me" view — ignores parentId.
      files = await getSharedWithUser(session.userId);
    } else if (parentId === null) {
      // Root listing of own files.
      files = await getFilesForUser(session.userId, null);
    } else {
      // Always use getInheritedChildren — it returns ALL children
      // regardless of owner, so collaborator-created subfolders
      // are visible. Parallelized internally for speed.
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

    const enriched = files.map((f) => ({
      ...f,
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
    let callerPermission: string | null = null;
    if (parentId) {
      callerPermission = await getEffectivePermission(parentId, session.userId);
    }

    const response = NextResponse.json({ files: enriched, callerPermission });
    // Edge cache — response is encrypted ciphertext, safe to cache
    // per-user for 15 seconds. Mutations invalidate via client refetch.
    response.headers.set("Cache-Control", "private, s-maxage=15, stale-while-revalidate=30");
    return response;
  } catch (err) {
    logError("files.list", err);
    return NextResponse.json({ error: "Failed to list files" }, { status: 500 });
  }
}
