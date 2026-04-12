import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { createFolder, createFileKey, getFileById } from "@/lib/db/files";
import { logError } from "@/lib/log";

const FolderSchema = z.object({
  encryptedMetadata: z.string().min(1),
  parentId: z.string().uuid().nullable(),
  publicHierarchicalKey: z.string().min(1),
  encryptedSessionKeyByFile: z.string().min(1),
  sessionKeyNonce: z.string().min(1),
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

    // If creating inside a parent folder, verify the caller has
    // access to it (owns it or holds a file_keys row). This gate
    // prevents a user from injecting an arbitrary parent_id for a
    // folder they can't see.
    if (data.parentId) {
      const parent = await getFileById(data.parentId, session.userId);
      if (!parent) {
        return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
      }
      if (!parent.is_folder) {
        return NextResponse.json({ error: "Parent is not a folder" }, { status: 400 });
      }
    }

    const folder = await createFolder({
      ownerId: session.userId,
      parentId: data.parentId,
      encryptedMetadata: data.encryptedMetadata,
      publicHierarchicalKey: data.publicHierarchicalKey,
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
