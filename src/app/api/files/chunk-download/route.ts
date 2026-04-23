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

    // Preservation-hold IP capture — tracks downloaders of a flagged
    // user's content so a forensic packet can show who pulled copies.
    const { logUserIp, extractRequestIp } = await import(
      "@/lib/db/trust-safety"
    );
    await logUserIp(session.userId, "download", extractRequestIp(request));

    const { file, directKey, parentChain, ancestorKey } = result;

    // Resolve the current version's id so we return ONLY its chunks.
    // Phase 4: file_chunks now holds rows for every historical version,
    // keyed by version_id. Without this filter, a file with v1 + v2
    // returns both sets of chunks and the client decrypts v1's chunk 0
    // with v2's session key (forward-secret by design = incompatible).
    const { data: currentVersion } = await supabase
      .from("file_versions")
      .select("id")
      .eq("file_id", fileId)
      .eq("version_number", file.current_version_number)
      .single();

    // Get chunks for the current version only.
    const chunksQuery = supabase
      .from("file_chunks")
      .select("*")
      .eq("file_id", fileId)
      .order("sequence");
    const { data: chunks, error } = currentVersion?.id
      ? await chunksQuery.eq("version_id", currentVersion.id)
      : await chunksQuery; // fallback for very old rows without version_id

    if (error) throw error;

    const base = {
      encryptedMetadata: file.encrypted_metadata,
      publicHierarchicalKey: file.public_hierarchical_key,
      publicKemHierarchicalKey: file.public_kem_hierarchical_key,
      encryptedSessionKeyByFile: file.encrypted_session_key_by_file,
      sessionKeyNonce: file.session_key_nonce,
      ownerPublicKey: file.owner_public_key,
      ownerPublicKemKey: file.owner_public_kem_key,
      // Direct key path (non-empty when user has a file_keys row)
      encryptedPrivateHierarchicalKey: directKey?.encrypted_private_hierarchical_key || "",
      wrappedByPublicKey: directKey?.wrapped_by_public_key || "",
      // Inherited path (non-empty when access is via parent chain)
      parentChain,
      ancestorKey,
    };

    if (chunks && chunks.length > 0) {
      const chunkDownloads = await Promise.all(
        chunks.map(async (chunk: { sequence: number; storage_key: string; encryption_nonce: string; is_final: boolean; shard: number | null }) => ({
          sequence: chunk.sequence,
          downloadUrl: await getDownloadUrl(chunk.shard ?? 0, chunk.storage_key),
          encryptionNonce: chunk.encryption_nonce,
          isFinal: chunk.is_final,
        }))
      );

      return NextResponse.json({ chunks: chunkDownloads, ...base });
    }

    // Folder or file without content — return key data only (used
    // by the client's parent-chain fetch to populate the hier key
    // cache for inherited children).
    return NextResponse.json({ noContent: true, ...base });
  } catch (err) {
    logError("chunk-download", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
