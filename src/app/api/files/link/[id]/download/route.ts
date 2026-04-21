import { NextResponse } from "next/server";
import { z } from "zod";
import { getLinkById } from "@/lib/db/files";
import { supabase } from "@/lib/db/supabase";
import { getDownloadUrl } from "@/lib/db/r2";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { anonymousRateLimitKey, assertLinkCovers } from "@/lib/auth/link-access";
import { logError } from "@/lib/log";

const ParamSchema = z.object({ id: z.string().uuid() });
const QuerySchema = z.object({ fileId: z.string().uuid() });

/**
 * Anonymous chunk download for a file reachable through a link. `fileId`
 * must equal the link's file_id (direct file link) or be a descendant of
 * a folder link. Reuses the Phase 2 chunk-download response shape so the
 * public /share/[id] page can reuse the same decrypt machinery.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsedId = ParamSchema.safeParse({ id });
    if (!parsedId.success) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const parsedQuery = QuerySchema.safeParse({ fileId: searchParams.get("fileId") });
    if (!parsedQuery.success) {
      return NextResponse.json({ error: "Invalid fileId" }, { status: 400 });
    }

    if (!(await checkRateLimit(anonymousRateLimitKey(request, "link:download"), 300))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const payload = await getLinkById(parsedId.data.id);
    if (!payload) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }
    if (!(await assertLinkCovers(payload, parsedQuery.data.fileId))) {
      return NextResponse.json({ error: "Outside link scope" }, { status: 403 });
    }

    // Fetch the target file's row (may be different from the link's file
    // if this is a folder link resolving a descendant).
    const { data: file, error } = await supabase
      .from("files")
      .select(
        "id, owner_id, is_folder, encrypted_metadata, storage_key, encryption_nonce, public_hierarchical_key, encrypted_session_key_by_file, session_key_nonce, current_version_number, owner:users!files_owner_id_fkey(public_encryption_key)"
      )
      .eq("id", parsedQuery.data.fileId)
      .eq("upload_complete", true)
      .is("deleted_at", null)
      .single();
    if (error || !file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    type FileRow = {
      id: string;
      is_folder: boolean;
      encrypted_metadata: string;
      storage_key: string | null;
      encryption_nonce: string | null;
      public_hierarchical_key: string;
      encrypted_session_key_by_file: string;
      session_key_nonce: string;
      current_version_number: number;
      owner: { public_encryption_key: string } | null;
    };
    const row = file as unknown as FileRow;
    if (row.is_folder) {
      return NextResponse.json({ error: "Folders aren't downloadable" }, { status: 400 });
    }

    // Phase 4: resolve the current version so we only return ITS
    // chunks. Without this filter, a file with multiple versions
    // returns every version's chunks and the client tries to decrypt
    // old ciphertext with the current session key → "invalid tag."
    // Same fix as authenticated chunk-download.
    const { data: currentVersion } = await supabase
      .from("file_versions")
      .select("id")
      .eq("file_id", row.id)
      .eq("version_number", row.current_version_number)
      .single();

    const chunksQuery = supabase
      .from("file_chunks")
      .select("sequence, storage_key, encryption_nonce, is_final")
      .eq("file_id", row.id)
      .order("sequence");
    const { data: chunks } = currentVersion?.id
      ? await chunksQuery.eq("version_id", currentVersion.id)
      : await chunksQuery;

    type Chunk = {
      sequence: number;
      storage_key: string;
      encryption_nonce: string;
      is_final: boolean;
    };
    if (chunks && chunks.length > 0) {
      const chunkDownloads = await Promise.all(
        (chunks as Chunk[]).map(async (c) => ({
          sequence: c.sequence,
          downloadUrl: await getDownloadUrl(c.storage_key),
          encryptionNonce: c.encryption_nonce,
          isFinal: c.is_final,
        }))
      );
      return NextResponse.json({
        chunked: true,
        chunks: chunkDownloads,
        encryptedMetadata: row.encrypted_metadata,
        publicHierarchicalKey: row.public_hierarchical_key,
        encryptedSessionKeyByFile: row.encrypted_session_key_by_file,
        sessionKeyNonce: row.session_key_nonce,
        ownerPublicKey: row.owner?.public_encryption_key ?? "",
      });
    }

    if (!row.storage_key) {
      return NextResponse.json({ error: "File has no content" }, { status: 404 });
    }
    const downloadUrl = await getDownloadUrl(row.storage_key);
    return NextResponse.json({
      chunked: false,
      downloadUrl,
      encryptedMetadata: row.encrypted_metadata,
      encryptionNonce: row.encryption_nonce,
      publicHierarchicalKey: row.public_hierarchical_key,
      encryptedSessionKeyByFile: row.encrypted_session_key_by_file,
      sessionKeyNonce: row.session_key_nonce,
      ownerPublicKey: row.owner?.public_encryption_key ?? "",
    });
  } catch (err) {
    logError("files.link.download", err);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
