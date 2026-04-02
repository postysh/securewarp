import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { createFile, createFileKey } from "@/lib/db/files";
import { getUploadUrl } from "@/lib/db/r2";
import { supabase } from "@/lib/db/supabase";

// Step 1: Initialize chunked upload — creates file record, returns presigned URLs for all chunks
const InitSchema = z.object({
  action: z.literal("init"),
  encryptedMetadata: z.string().min(1),
  encryptedSessionKey: z.string().min(1),
  parentId: z.string().uuid().nullable(),
  totalSizeBytes: z.number().positive(),
  chunkCount: z.number().int().positive(),
});

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

      // Create file record
      const file = await createFile({
        ownerId: session.userId,
        parentId: data.parentId,
        encryptedMetadata: data.encryptedMetadata,
        isFolder: false,
        sizeBytes: data.totalSizeBytes,
        storageKey: null, // chunks have their own storage keys
      });

      // Update chunk count
      await supabase.from("files").update({ chunk_count: data.chunkCount }).eq("id", file.id);

      // Store encrypted session key
      await createFileKey({
        fileId: file.id,
        userId: session.userId,
        encryptedSessionKey: data.encryptedSessionKey,
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

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("Chunk upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
