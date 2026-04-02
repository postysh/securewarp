import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getFileById } from "@/lib/db/files";
import { getDownloadUrl } from "@/lib/db/r2";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get("fileId");

    if (!fileId) {
      return NextResponse.json({ error: "File ID required" }, { status: 400 });
    }

    const file = await getFileById(fileId, session.userId);
    if (!file || !file.storage_key) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const downloadUrl = await getDownloadUrl(file.storage_key);

    return NextResponse.json({
      downloadUrl,
      encryptedMetadata: file.encrypted_metadata,
      encryptedSessionKey: file.encrypted_session_key,
      encryptionNonce: file.encryption_nonce,
    });
  } catch (err) {
    console.error("Download error:", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
