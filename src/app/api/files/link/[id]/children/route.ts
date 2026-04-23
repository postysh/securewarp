import { NextResponse } from "next/server";
import { z } from "zod";
import { getLinkById } from "@/lib/db/files";
import { supabase } from "@/lib/db/supabase";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { anonymousRateLimitKey, assertLinkCovers } from "@/lib/auth/link-access";
import { logError } from "@/lib/log";

const ParamSchema = z.object({ id: z.string().uuid() });
const QuerySchema = z.object({ parentId: z.string().uuid() });

/**
 * Anonymous listing of children inside a folder link. `parentId` must be
 * the link's own file_id OR a descendant of it — enforced by
 * assertLinkCovers so a link to folder A can never be used to read
 * folder B's contents.
 *
 * Returns the minimum data needed to perform a Phase 3 parent_keys_claim
 * walk from the client: no file_keys, no avatars, no owner emails.
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
    const parsedQuery = QuerySchema.safeParse({ parentId: searchParams.get("parentId") });
    if (!parsedQuery.success) {
      return NextResponse.json({ error: "Invalid parentId" }, { status: 400 });
    }

    if (!(await checkRateLimit(anonymousRateLimitKey(request, "link:children"), 300))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const payload = await getLinkById(parsedId.data.id);
    if (!payload) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }
    if (!payload.file.is_folder) {
      return NextResponse.json({ error: "Not a folder link" }, { status: 400 });
    }
    if (!(await assertLinkCovers(payload, parsedQuery.data.parentId))) {
      return NextResponse.json({ error: "Outside link scope" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("files")
      .select(
        "id, parent_id, encrypted_metadata, is_folder, size_bytes, storage_key, encryption_nonce, chunk_count, public_hierarchical_key, encrypted_session_key_by_file, session_key_nonce, parent_keys_claim, parent_keys_claim_wrapped_by, owner:users!files_owner_id_fkey(public_encryption_key)"
      )
      .eq("parent_id", parsedQuery.data.parentId)
      .eq("upload_complete", true)
      .is("deleted_at", null)
      .is("evidence_hold_at", null)
      .order("is_folder", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;

    type Row = {
      id: string;
      parent_id: string | null;
      encrypted_metadata: string;
      is_folder: boolean;
      size_bytes: number;
      storage_key: string | null;
      encryption_nonce: string | null;
      chunk_count: number;
      public_hierarchical_key: string;
      encrypted_session_key_by_file: string;
      session_key_nonce: string;
      parent_keys_claim: string | null;
      parent_keys_claim_wrapped_by: string | null;
      owner: { public_encryption_key: string } | null;
    };

    return NextResponse.json({
      children: ((data ?? []) as unknown as Row[]).map((c) => ({
        id: c.id,
        parentId: c.parent_id,
        encryptedMetadata: c.encrypted_metadata,
        isFolder: c.is_folder,
        sizeBytes: c.size_bytes,
        chunkCount: c.chunk_count,
        publicHierarchicalKey: c.public_hierarchical_key,
        encryptedSessionKeyByFile: c.encrypted_session_key_by_file,
        sessionKeyNonce: c.session_key_nonce,
        parentKeysClaim: c.parent_keys_claim,
        parentKeysClaimWrappedBy: c.parent_keys_claim_wrapped_by,
        ownerPublicKey: c.owner?.public_encryption_key ?? "",
      })),
    });
  } catch (err) {
    logError("files.link.children", err);
    return NextResponse.json({ error: "Failed to list" }, { status: 500 });
  }
}
