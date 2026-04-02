import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { createFolder, createFileKey } from "@/lib/db/files";

const FolderSchema = z.object({
  encryptedMetadata: z.string().min(1),
  encryptedSessionKey: z.string().min(1),
  parentId: z.string().uuid().nullable(),
});

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

    const folder = await createFolder({
      ownerId: session.userId,
      parentId: data.parentId,
      encryptedMetadata: data.encryptedMetadata,
    });

    await createFileKey({
      fileId: folder.id,
      userId: session.userId,
      encryptedSessionKey: data.encryptedSessionKey,
    });

    return NextResponse.json({ folderId: folder.id });
  } catch (err) {
    console.error("Create folder error:", err);
    return NextResponse.json({ error: "Failed to create folder" }, { status: 500 });
  }
}
