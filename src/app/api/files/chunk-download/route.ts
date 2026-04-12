import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getFileForDownload } from "@/lib/db/files";
import { getDownloadUrl } from "@/lib/db/r2";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

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

    // Supports both direct file_keys access AND inherited access
    // via the parent_keys_claim chain. Returns the full chain so
    // the client can walk it to derive the session key.
    const result = await getFileForDownload(fileId, session.userId);
    if (!result) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const { file, directKey, parentChain, ancestorKey } = result;

    // Get chunks
    const { data: chunks, error } = await supabase
      .from("file_chunks")
      .select("*")
      .eq("file_id", fileId)
      .order("sequence");

    if (error) throw error;

    const base = {
      encryptedMetadata: file.encrypted_metadata,
      publicHierarchicalKey: file.public_hierarchical_key,
      encryptedSessionKeyByFile: file.encrypted_session_key_by_file,
      sessionKeyNonce: file.session_key_nonce,
      ownerPublicKey: file.owner_public_key,
      // Direct key path (non-empty when user has a file_keys row)
      encryptedPrivateHierarchicalKey: directKey?.encrypted_private_hierarchical_key || "",
      wrappedByPublicKey: directKey?.wrapped_by_public_key || "",
      // Inherited path (non-empty when access is via parent chain)
      parentChain,
      ancestorKey,
    };

    if (chunks && chunks.length > 0) {
      const chunkDownloads = await Promise.all(
        chunks.map(async (chunk: { sequence: number; storage_key: string; encryption_nonce: string; is_final: boolean }) => ({
          sequence: chunk.sequence,
          downloadUrl: await getDownloadUrl(chunk.storage_key),
          encryptionNonce: chunk.encryption_nonce,
          isFinal: chunk.is_final,
        }))
      );

      return NextResponse.json({ chunked: true, chunks: chunkDownloads, ...base });
    }

    // Folder or file without content — return key data only (used
    // by the client's parent-chain fetch to populate the hier key
    // cache for inherited children).
    if (!file.storage_key) {
      const resp = NextResponse.json({ chunked: false, noContent: true, ...base });
      resp.headers.set("Cache-Control", "private, s-maxage=60, stale-while-revalidate=120");
      return resp;
    }

    const downloadUrl = await getDownloadUrl(file.storage_key);
    return NextResponse.json({
      chunked: false,
      downloadUrl,
      encryptionNonce: file.encryption_nonce,
      ...base,
    });
  } catch (err) {
    logError("chunk-download", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
