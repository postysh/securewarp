import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import {
  createFile,
  createFileKey,
  createFileVersion,
  getEffectivePermission,
} from "@/lib/db/files";
import { getUploadUrl } from "@/lib/db/r2";
import { supabase } from "@/lib/db/supabase";
import { assertWithinQuota } from "@/lib/db/quota";
import { pruneVersionsForFile } from "@/lib/db/version-prune";
import { getBoolFlag } from "@/lib/flags";
import { auditEvent } from "@/lib/audit";
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
  // Version the chunk belongs to. Returned by /init (and later by
  // the new-version route). Optional for backward compat with any
  // in-flight pre-migration clients — server falls back to the
  // file's v1 in that case.
  versionId: z.string().uuid().optional(),
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
  // Optional: the version being finalized. When present the server
  // knows this is a "new version" finalize (bump counters, update
  // files metadata to point at this version). Absent = initial v1
  // upload, just flip upload_complete.
  versionId: z.string().uuid().optional(),
});

// New-version init — uploading replacement content for an existing
// file. Reuses the file's existing session_key + public_hierarchical_key
// (no new crypto material on the wire), so file_keys rows stay valid
// for every collaborator across every version.
const NewVersionInitSchema = z.object({
  action: z.literal("new-version-init"),
  fileId: z.string().uuid(),
  encryptedMetadata: z.string().min(1),
  totalSizeBytes: z.number().positive(),
  chunkCount: z.number().int().positive(),
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
      // Feature-flag gate. Admin can freeze new uploads (e.g. during an
      // R2 outage) without redeploying. We only gate `init` — in-flight
      // chunks for an already-initialized file keep working, so users
      // don't end up with half-uploaded orphans during a toggle.
      if (!(await getBoolFlag("uploads_enabled"))) {
        return NextResponse.json(
          { error: "Uploads are temporarily disabled. Please try again later." },
          { status: 503 }
        );
      }

      const parsed = InitSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid data" }, { status: 400 });
      }

      const data = parsed.data;

      // Permission check: viewers cannot upload into shared folders.
      if (data.parentId) {
        const perm = await getEffectivePermission(data.parentId, session.userId);
        if (perm === "viewer") {
          return NextResponse.json({ error: "Viewers cannot upload files" }, { status: 403 });
        }
        if (!perm) {
          return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
        }
      }

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

      // Create v1 row in file_versions. Shared session key model —
      // every future version of this file reuses the same session key
      // and hierarchical keypair that we wrote to `files` above, so
      // file_keys rows stay valid across all versions. The version row
      // snapshots the metadata + size + chunk count at this point so
      // old versions can be listed and restored later.
      const version = await createFileVersion({
        fileId: file.id,
        versionNumber: 1,
        encryptedMetadata: data.encryptedMetadata,
        sizeBytes: data.totalSizeBytes,
        chunkCount: data.chunkCount,
        createdByUserId: session.userId,
      });

      // Generate presigned URLs for all chunks. Storage keys now
      // include the version id so multiple versions of the same file
      // can co-exist in R2 without collisions.
      const chunkUrls: { sequence: number; storageKey: string; uploadUrl: string }[] = [];
      for (let i = 0; i < data.chunkCount; i++) {
        const storageKey = `${session.userId}/${file.id}/v${version.version_number}/chunk-${i}`;
        const uploadUrl = await getUploadUrl(storageKey);
        chunkUrls.push({ sequence: i, storageKey, uploadUrl });
      }

      return NextResponse.json({ fileId: file.id, versionId: version.id, chunkUrls });
    }

    // ─── NEW VERSION INIT ───
    // Upload a replacement of an existing file's content. Reuses the
    // file's existing session_key + hierarchical keypair — collaborators
    // keep their file_keys rows unchanged and see the new version.
    if (body.action === "new-version-init") {
      if (!(await getBoolFlag("uploads_enabled"))) {
        return NextResponse.json(
          { error: "Uploads are temporarily disabled. Please try again later." },
          { status: 503 },
        );
      }

      const parsed = NewVersionInitSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid data" }, { status: 400 });
      }
      const data = parsed.data;

      // Owner-only for now. Once editors can replace file content,
      // gate on getEffectivePermission() === "owner"|"editor" instead.
      const { data: file } = await supabase
        .from("files")
        .select("id, owner_id, is_folder, current_version_number, size_bytes")
        .eq("id", data.fileId)
        .eq("owner_id", session.userId)
        .single();
      if (!file) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      if (file.is_folder) {
        return NextResponse.json(
          { error: "Cannot version a folder" },
          { status: 400 },
        );
      }

      // Quota: the replacement adds its size in full — the old chunks
      // still count until retention prunes them. Check against the delta
      // rather than the absolute new size so shrinks get credit.
      const delta = Math.max(0, data.totalSizeBytes);
      try {
        await assertWithinQuota(session.userId, delta);
      } catch (e) {
        const status = (e as { status?: number }).status ?? 500;
        return NextResponse.json({ error: (e as Error).message }, { status });
      }

      const nextVersionNumber = (file.current_version_number as number) + 1;
      const version = await createFileVersion({
        fileId: data.fileId,
        versionNumber: nextVersionNumber,
        encryptedMetadata: data.encryptedMetadata,
        sizeBytes: data.totalSizeBytes,
        chunkCount: data.chunkCount,
        createdByUserId: session.userId,
      });

      const chunkUrls: { sequence: number; storageKey: string; uploadUrl: string }[] = [];
      for (let i = 0; i < data.chunkCount; i++) {
        const storageKey = `${session.userId}/${data.fileId}/v${version.version_number}/chunk-${i}`;
        const uploadUrl = await getUploadUrl(storageKey);
        chunkUrls.push({ sequence: i, storageKey, uploadUrl });
      }

      auditEvent({
        event: "files.version_create",
        actorUserId: session.userId,
        targetFileId: data.fileId,
        detail: `v${nextVersionNumber}`,
      });

      return NextResponse.json({
        fileId: data.fileId,
        versionId: version.id,
        versionNumber: nextVersionNumber,
        chunkUrls,
      });
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

      // Resolve which version this chunk belongs to. Prefer the
      // explicit versionId the client supplied; fall back to the
      // file's v1 (shouldn't happen post-migration, but backwards
      // compat with any in-flight client that hasn't been updated).
      let versionId = data.versionId ?? null;
      if (!versionId) {
        const { data: v1 } = await supabase
          .from("file_versions")
          .select("id")
          .eq("file_id", data.fileId)
          .eq("version_number", 1)
          .single();
        versionId = (v1?.id as string | null) ?? null;
      }

      // Insert chunk record
      const { error } = await supabase.from("file_chunks").insert({
        file_id: data.fileId,
        version_id: versionId,
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
      const { fileId, versionId } = parsed.data;

      // Owner check — only the owner's session can finalize.
      const { data: file } = await supabase
        .from("files")
        .select("chunk_count, current_version_number")
        .eq("id", fileId)
        .eq("owner_id", session.userId)
        .single();
      if (!file) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }

      // Two paths:
      //   - Initial v1 upload: versionId absent. Count chunks by
      //     file_id (they all belong to v1). Flip upload_complete.
      //   - New version upload: versionId present. Count chunks by
      //     version_id so we don't accidentally mix counts with v1's.
      //     Bump current_version_number + version_count and update
      //     the denormalized metadata columns on `files` so listings
      //     reflect the new version.
      if (versionId) {
        const { data: version } = await supabase
          .from("file_versions")
          .select("chunk_count, version_number, size_bytes, encrypted_metadata")
          .eq("id", versionId)
          .eq("file_id", fileId)
          .single();
        if (!version) {
          return NextResponse.json({ error: "Version not found" }, { status: 404 });
        }

        const { data: chunks } = await supabase
          .from("file_chunks")
          .select("sequence")
          .eq("version_id", versionId);
        if (!chunks || chunks.length !== version.chunk_count) {
          return NextResponse.json(
            { error: "Not all chunks uploaded" },
            { status: 400 },
          );
        }

        // Commit: point `files` at the new version so list endpoints
        // render the new metadata immediately. version_count is an
        // authoritative count derived by +1 from before; the sql
        // DEFAULT 1 is for backfilled rows.
        const { error: finalizeErr } = await supabase
          .from("files")
          .update({
            current_version_number: version.version_number,
            version_count: (file.current_version_number as number) + 1 === version.version_number
              ? (file.current_version_number as number) + 1
              : version.version_number,
            encrypted_metadata: version.encrypted_metadata,
            size_bytes: version.size_bytes,
            chunk_count: version.chunk_count,
            updated_at: new Date().toISOString(),
          })
          .eq("id", fileId)
          .eq("owner_id", session.userId);
        if (finalizeErr) throw finalizeErr;

        // Retention prune — best-effort. The new version is already
        // live, so pruning older ones on failure just defers to the
        // nightly cron instead of rolling back the upload. Never let
        // a prune error fail the finalize response.
        try {
          await pruneVersionsForFile(session.userId, fileId);
        } catch (err) {
          logError("chunk-upload.prune", { fileId, err });
        }

        return NextResponse.json({ success: true });
      }

      // Initial v1 finalize: scope chunk count by file_id (v1 is the
      // only version in existence).
      const { data: chunks } = await supabase
        .from("file_chunks")
        .select("sequence")
        .eq("file_id", fileId)
        .order("sequence");

      if (!chunks || chunks.length !== file.chunk_count) {
        return NextResponse.json({ error: "Not all chunks uploaded" }, { status: 400 });
      }

      const { error: finalizeErr } = await supabase
        .from("files")
        .update({ upload_complete: true })
        .eq("id", fileId)
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
