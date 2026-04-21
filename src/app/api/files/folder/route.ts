import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { createFolder, createFileKey, getFileById, getEffectivePermission } from "@/lib/db/files";
import { assertWithinQuota } from "@/lib/db/quota";
import { logError } from "@/lib/log";

const FolderSchema = z.object({
  encryptedMetadata: z.string().min(1),
  parentId: z.string().uuid().nullable(),
  publicHierarchicalKey: z.string().min(1),
  publicKemHierarchicalKey: z.string().min(1),
  encryptedSessionKeyByFile: z.string().min(1),
  sessionKeyNonce: z.string(),
  encryptedPrivateHierarchicalKey: z.string().min(1),
  wrappedByPublicKey: z.string().min(1),
  parentKeysClaim: z.string().min(1).optional(),
  parentKeysClaimWrappedBy: z.string().min(1).optional(),
}).refine(
  (v) => (v.parentId === null) === (v.parentKeysClaim === undefined),
  { message: "parent_keys_claim must be present iff parentId is set" }
);

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = FolderSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid folder data" }, { status: 400 });
    }

    const data = parsed.data;

    // Quota check — same as file uploads
    try {
      await assertWithinQuota(session.userId, 0);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      return NextResponse.json({ error: (e as Error).message }, { status });
    }

    // If creating inside a parent folder, verify the caller has
    // access to it (owns it or holds a file_keys row). This gate
    // prevents a user from injecting an arbitrary parent_id for a
    // folder they can't see.
    if (data.parentId) {
      const parent = await getFileById(data.parentId, session.userId);
      if (!parent) {
        // getFileById requires a direct file_keys row — for inherited
        // access, check via the permission chain instead.
        const perm = await getEffectivePermission(data.parentId, session.userId);
        if (!perm) {
          return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
        }
        if (perm === "viewer") {
          return NextResponse.json({ error: "Viewers cannot create folders" }, { status: 403 });
        }
      } else {
        if (!parent.is_folder) {
          return NextResponse.json({ error: "Parent is not a folder" }, { status: 400 });
        }
        // Check permission — owner and editor can create, viewer cannot
        const perm = await getEffectivePermission(data.parentId, session.userId);
        if (perm === "viewer") {
          return NextResponse.json({ error: "Viewers cannot create folders" }, { status: 403 });
        }
      }
    }

    const folder = await createFolder({
      ownerId: session.userId,
      parentId: data.parentId,
      encryptedMetadata: data.encryptedMetadata,
      publicHierarchicalKey: data.publicHierarchicalKey,
      publicKemHierarchicalKey: data.publicKemHierarchicalKey,
      encryptedSessionKeyByFile: data.encryptedSessionKeyByFile,
      sessionKeyNonce: data.sessionKeyNonce,
      parentKeysClaim: data.parentKeysClaim ?? null,
      parentKeysClaimWrappedBy: data.parentKeysClaimWrappedBy ?? null,
    });

    await createFileKey({
      fileId: folder.id,
      userId: session.userId,
      encryptedPrivateHierarchicalKey: data.encryptedPrivateHierarchicalKey,
      wrappedByPublicKey: data.wrappedByPublicKey,
    });

    return NextResponse.json({ folderId: folder.id });
  } catch (err) {
    logError("files.folder", err);
    return NextResponse.json({ error: "Failed to create folder" }, { status: 500 });
  }
}
