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
    const parentId = searchParams.get("parentId") || null;

    let files: FileRowWithKey[];
    if (starred) {
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
      // Listing inside a specific folder. Always use
      // getInheritedChildren so the response includes ALL children
      // regardless of owner — collaborators who create subfolders
      // inside a shared folder own those subfolders, but the parent
      // folder's owner still needs to see them.
      files = await getInheritedChildren(parentId, session.userId);
    }

    // Enrich each file with its collaborator list and per-user star state.
    const fileIds = files.map((f) => f.id);
    const collaboratorMap = await getCollaboratorsBulk(fileIds);

    // Per-user stars — one query for all files in this batch
    const { data: starRows } = await supabase
      .from("user_stars")
      .select("file_id")
      .eq("user_id", session.userId)
      .in("file_id", fileIds);
    const starredSet = new Set((starRows || []).map((r) => r.file_id as string));

    const enriched = files.map((f) => ({
      ...f,
      is_starred: starredSet.has(f.id),
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

    return NextResponse.json({ files: enriched, callerPermission });
  } catch (err) {
    logError("files.list", err);
    return NextResponse.json({ error: "Failed to list files" }, { status: 500 });
  }
}
