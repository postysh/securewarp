import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getFileById } from "@/lib/db/files";
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

    const file = await getFileById(fileId, session.userId);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Get all chunks ordered by sequence
    const { data: chunks, error } = await supabase
      .from("file_chunks")
      .select("*")
      .eq("file_id", fileId)
      .order("sequence");

    if (error) throw error;

    // If file has chunks, return chunk download URLs
    if (chunks && chunks.length > 0) {
      const chunkDownloads = await Promise.all(
        chunks.map(async (chunk: { sequence: number; storage_key: string; encryption_nonce: string; is_final: boolean }) => ({
          sequence: chunk.sequence,
          downloadUrl: await getDownloadUrl(chunk.storage_key),
          encryptionNonce: chunk.encryption_nonce,
          isFinal: chunk.is_final,
        }))
      );

      return NextResponse.json({
        chunked: true,
        chunks: chunkDownloads,
        encryptedMetadata: file.encrypted_metadata,
        // Phase 2 hierarchical payload — client unwraps the priv hier key
        // from its file_keys row, then uses it to unwrap the session key
        // wrapped to the file's public hier key.
        publicHierarchicalKey: file.public_hierarchical_key,
        encryptedSessionKeyByFile: file.encrypted_session_key_by_file,
        sessionKeyNonce: file.session_key_nonce,
        encryptedPrivateHierarchicalKey: file.encrypted_private_hierarchical_key,
        wrappedByPublicKey: file.wrapped_by_public_key,
        ownerPublicKey: file.owner_public_key,
      });
    }

    // Legacy single-blob file
    if (!file.storage_key) {
      return NextResponse.json({ error: "File has no content" }, { status: 404 });
    }

    const downloadUrl = await getDownloadUrl(file.storage_key);
    return NextResponse.json({
      chunked: false,
      downloadUrl,
      encryptedMetadata: file.encrypted_metadata,
      encryptionNonce: file.encryption_nonce,
      publicHierarchicalKey: file.public_hierarchical_key,
      encryptedSessionKeyByFile: file.encrypted_session_key_by_file,
      sessionKeyNonce: file.session_key_nonce,
      encryptedPrivateHierarchicalKey: file.encrypted_private_hierarchical_key,
      wrappedByPublicKey: file.wrapped_by_public_key,
      ownerPublicKey: file.owner_public_key,
    });
  } catch (err) {
    logError("chunk-download", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
