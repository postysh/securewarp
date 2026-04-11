import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { createFile, createFileKey } from "@/lib/db/files";
import { getUploadUrl } from "@/lib/db/r2";
import { supabase } from "@/lib/db/supabase";
import { assertWithinQuota } from "@/lib/db/quota";
import { logError } from "@/lib/log";

// Step 1: Initialize chunked upload — creates file record, returns presigned URLs for all chunks
const InitSchema = z.object({
  action: z.literal("init"),
  encryptedMetadata: z.string().min(1),
  parentId: z.string().uuid().nullable(),
  totalSizeBytes: z.number().positive(),
  chunkCount: z.number().int().positive(),
  // Phase 2 hierarchical key payload — all client-generated.
  publicHierarchicalKey: z.string().min(1),
  encryptedSessionKeyByFile: z.string().min(1),
  sessionKeyNonce: z.string().min(1),
  encryptedPrivateHierarchicalKey: z.string().min(1),
  // Sharer's public key at wrap time. For a fresh upload this is always the
  // owner's own public key, but we pass it explicitly so the server never
  // has to infer it.
  wrappedByPublicKey: z.string().min(1),
  // Phase 3 — folder inheritance. Required when parentId is set; forbidden
  // when parentId is null (root uploads have no parent to inherit from).
  parentKeysClaim: z.string().min(1).optional(),
  parentKeysClaimWrappedBy: z.string().min(1).optional(),
}).refine(
  (v) => (v.parentId === null) === (v.parentKeysClaim === undefined),
  { message: "parent_keys_claim must be present iff parentId is set" }
);

// Step 2: Register a chunk after upload
const ChunkSchema = z.object({
  action: z.literal("chunk"),
  fileId: z.string().uuid(),
  sequence: z.number().int().min(0),
  isFinal: z.boolean(),
  sizeBytes: z.number().positive(),
  storageKey: z.string().min(1),
  encryptionNonce: z.string().min(1),
});

// Step 3: Finalize — confirm all chunks uploaded
const FinalizeSchema = z.object({
  action: z.literal("finalize"),
  fileId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // ─── INIT ───
    if (body.action === "init") {
      const parsed = InitSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid data" }, { status: 400 });
      }

      const data = parsed.data;

      // Reject uploads that would exceed the per-user storage quota.
      try {
        await assertWithinQuota(session.userId, data.totalSizeBytes);
      } catch (e) {
        const status = (e as { status?: number }).status ?? 500;
        return NextResponse.json({ error: (e as Error).message }, { status });
      }

      // Create file record (upload_complete defaults to false — row is
      // hidden from listings until the finalize step confirms all chunks).
      const file = await createFile({
        ownerId: session.userId,
        parentId: data.parentId,
        encryptedMetadata: data.encryptedMetadata,
        isFolder: false,
        sizeBytes: data.totalSizeBytes,
        storageKey: null, // chunks have their own storage keys
        uploadComplete: false,
        publicHierarchicalKey: data.publicHierarchicalKey,
        encryptedSessionKeyByFile: data.encryptedSessionKeyByFile,
        sessionKeyNonce: data.sessionKeyNonce,
        parentKeysClaim: data.parentKeysClaim ?? null,
        parentKeysClaimWrappedBy: data.parentKeysClaimWrappedBy ?? null,
      });

      // Update chunk count
      await supabase.from("files").update({ chunk_count: data.chunkCount }).eq("id", file.id);

      // Owner's wrapped private hierarchical key row.
      await createFileKey({
        fileId: file.id,
        userId: session.userId,
        encryptedPrivateHierarchicalKey: data.encryptedPrivateHierarchicalKey,
        wrappedByPublicKey: data.wrappedByPublicKey,
      });

      // Generate presigned URLs for all chunks
      const chunkUrls: { sequence: number; storageKey: string; uploadUrl: string }[] = [];
      for (let i = 0; i < data.chunkCount; i++) {
        const storageKey = `${session.userId}/${file.id}/chunk-${i}`;
        const uploadUrl = await getUploadUrl(storageKey);
        chunkUrls.push({ sequence: i, storageKey, uploadUrl });
      }

      return NextResponse.json({ fileId: file.id, chunkUrls });
    }

    // ─── CHUNK ───
    if (body.action === "chunk") {
      const parsed = ChunkSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid data" }, { status: 400 });
      }

      const data = parsed.data;

      // Verify file belongs to user
      const { data: file } = await supabase
        .from("files")
        .select("id")
        .eq("id", data.fileId)
        .eq("owner_id", session.userId)
        .single();

      if (!file) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }

      // Insert chunk record
      const { error } = await supabase.from("file_chunks").insert({
        file_id: data.fileId,
        sequence: data.sequence,
        is_final: data.isFinal,
        size_bytes: data.sizeBytes,
        storage_key: data.storageKey,
        encryption_nonce: data.encryptionNonce,
      });

      if (error) throw error;

      return NextResponse.json({ success: true });
    }

    // ─── FINALIZE ───
    if (body.action === "finalize") {
      const parsed = FinalizeSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid data" }, { status: 400 });
      }

      // Verify all chunks are uploaded
      const { data: chunks } = await supabase
        .from("file_chunks")
        .select("sequence")
        .eq("file_id", parsed.data.fileId)
        .order("sequence");

      const { data: file } = await supabase
        .from("files")
        .select("chunk_count")
        .eq("id", parsed.data.fileId)
        .eq("owner_id", session.userId)
        .single();

      if (!file || !chunks || chunks.length !== file.chunk_count) {
        return NextResponse.json({ error: "Not all chunks uploaded" }, { status: 400 });
      }

      // Mark the file as visible now that all chunks have been registered.
      const { error: finalizeErr } = await supabase
        .from("files")
        .update({ upload_complete: true })
        .eq("id", parsed.data.fileId)
        .eq("owner_id", session.userId);
      if (finalizeErr) throw finalizeErr;

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    logError("chunk-upload", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
