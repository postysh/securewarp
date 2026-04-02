import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { createFile, createFileKey } from "@/lib/db/files";
import { getUploadUrl } from "@/lib/db/r2";

const TWENTY_GB = 20 * 1024 * 1024 * 1024;

const UploadSchema = z.object({
  encryptedMetadata: z.string().min(1),
  encryptedSessionKey: z.string().min(1),
  parentId: z.string().uuid().nullable(),
  sizeBytes: z.number().positive(),
  nonce: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = UploadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid upload data" }, { status: 400 });
    }

    const data = parsed.data;

    // TODO: Check storage quota (20 GB free)

    // Generate storage key
    const storageKey = `${session.userId}/${crypto.randomUUID()}`;

    // Create file record
    const file = await createFile({
      ownerId: session.userId,
      parentId: data.parentId,
      encryptedMetadata: data.encryptedMetadata,
      isFolder: false,
      sizeBytes: data.sizeBytes,
      storageKey,
      encryptionNonce: data.nonce,
    });

    // Store encrypted session key for the owner
    await createFileKey({
      fileId: file.id,
      userId: session.userId,
      encryptedSessionKey: data.encryptedSessionKey,
    });

    // Generate presigned upload URL
    const uploadUrl = await getUploadUrl(storageKey);

    return NextResponse.json({
      fileId: file.id,
      storageKey,
      uploadUrl,
      nonce: data.nonce,
    });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
