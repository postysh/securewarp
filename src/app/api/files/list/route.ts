import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import {
  getFilesForUser,
  getSharedWithUser,
  getCollaboratorsBulk,
  getFileById,
  getInheritedChildren,
  getTrashedForUser,
  type FileRowWithKey,
} from "@/lib/db/files";
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
    const parentId = searchParams.get("parentId") || null;

    let files: FileRowWithKey[];
    if (trash) {
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
      // Listing inside a specific folder. If the caller owns the folder,
      // the fast getFilesForUser path applies. Otherwise the caller must
      // still have access via a direct file_keys row on the folder
      // (gated inside getInheritedChildren), and the response includes
      // children that may not have direct rows — the client decrypts
      // those via the parent_keys_claim chain.
      const parent = await getFileById(parentId, session.userId);
      if (!parent) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }
      files =
        parent.owner_id === session.userId
          ? await getFilesForUser(session.userId, parentId)
          : await getInheritedChildren(parentId, session.userId);
    }

    // Enrich each file with its collaborator list so the browser can show
    // an avatar stack without a follow-up per-row query. This is a single
    // extra DB round-trip regardless of file count.
    const collaboratorMap = await getCollaboratorsBulk(files.map((f) => f.id));
    const enriched = files.map((f) => ({
      ...f,
      collaborators: (collaboratorMap.get(f.id) ?? []).map((c) => ({
        userId: c.user_id,
        email: c.email,
        isOwner: c.is_owner,
        permissionLevel: c.permission_level,
      })),
    }));

    return NextResponse.json({ files: enriched });
  } catch (err) {
    logError("files.list", err);
    return NextResponse.json({ error: "Failed to list files" }, { status: 500 });
  }
}
