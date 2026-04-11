import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { deleteFile } from "@/lib/db/files";
import { deleteBlob } from "@/lib/db/r2";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const DeleteSchema = z.object({
  fileId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = DeleteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const fileId = parsed.data.fileId;

    // Get all chunk storage keys before deleting
    const { data: chunks } = await supabase
      .from("file_chunks")
      .select("storage_key")
      .eq("file_id", fileId);

    // Delete the file record (cascades to file_keys and file_chunks)
    const storageKey = await deleteFile(fileId, session.userId);

    // Delete single-blob from R2 if exists
    if (storageKey) {
      await deleteBlob(storageKey);
    }

    // Delete all chunks from R2
    if (chunks && chunks.length > 0) {
      await Promise.all(
        chunks.map((chunk: { storage_key: string }) => deleteBlob(chunk.storage_key))
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.delete", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
