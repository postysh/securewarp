import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import {
  createFile,
  createFileKey,
  createFileVersion,
  getEffectivePermission,
} from "@/lib/db/files";
import { getUploadUrl, shardForChunk } from "@/lib/db/r2";
import { supabase } from "@/lib/db/supabase";
import { assertWithinQuota } from "@/lib/db/quota";
import { pruneVersionsForFile } from "@/lib/db/version-prune";
import { getBoolFlag } from "@/lib/flags";
import { auditEvent } from "@/lib/audit";
import { broadcast, broadcastFileMutation } from "@/lib/realtime/broadcast";
import { channelForWorkspace } from "@/lib/realtime/channels";
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
  // Crypto v2 Phase 2b — ML-KEM half of the file's hybrid hier keypair.
  publicKemHierarchicalKey: z.string().min(1),
  encryptedSessionKeyByFile: z.string().min(1),
  // v2: nonce is embedded in the hybrid blob; kept on wire+DB for
  // back-compat but accepted as empty.
  sessionKeyNonce: z.string(),
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

// Step 3: Finalize — confirm all chunks uploaded + register them.
// Chunk rows are batch-inserted here rather than per-chunk mid-upload:
// the per-chunk POST added ~330 ms serial-per-chunk wall time (CF
// Worker → Supabase round-trip) while the R2 PUT was already done
// and the concurrency gate was waiting on BOTH to resolve before
// dispatching the next chunk. Moving registration to a single
// batched INSERT at the end drops ~6-7 s off a 100-chunk upload.
//
// Crash safety: if the client disconnects mid-upload, R2 blobs are
// orphaned but the DB has no stale chunk rows. The cleanup-stale
// cron sweeps orphan R2 blobs every 24 h by matching them against
// files whose upload_complete = false.
const FinalizeChunkSchema = z.object({
  sequence: z.number().int().min(0),
  shard: z.number().int().min(0).max(63),
  storageKey: z.string().min(1),
  encryptionNonce: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  isFinal: z.boolean(),
});
const FinalizeSchema = z.object({
  action: z.literal("finalize"),
  fileId: z.string().uuid(),
  // Optional: the version being finalized. When present the server
  // knows this is a "new version" finalize (bump counters, update
  // files metadata to point at this version). Absent = initial v1
  // upload, just flip upload_complete.
  versionId: z.string().uuid().optional(),
  // All chunks, batched. Replaces the per-chunk action:"chunk" POSTs
  // that used to register them one at a time. Empty array is valid
  // only for zero-size uploads (rare but possible).
  chunks: z.array(FinalizeChunkSchema),
});

// Client calls this when a chunk PUT returns 403 mid-upload (the
// original URL expired — possible on multi-hour uploads or if the
// upload is resumed in a later session). Returns a fresh presigned
// URL under the SAME storage key, so the already-registered chunk
// rows and the client's inflight state stay consistent.
//
// Cap of 64 per call bounds CPU spend on Workers (each URL ≈ 0.5 ms
// HMAC signing) and keeps the response body small. Callers asking
// for more can issue multiple requests.
const RefreshUrlsSchema = z.object({
  action: z.literal("refresh-urls"),
  fileId: z.string().uuid(),
  versionId: z.string().uuid().optional(),
  chunkIndexes: z.array(z.number().int().min(0)).min(1).max(64),
});

// New-version init — uploading replacement content for an existing
// file. Crypto v2 Phase 4: each version now carries its own fresh
// session key (wrapped to the file's unchanged hierarchical pub keys).
// file_keys rows still stay valid across versions because the hier
// keypair doesn't rotate — only the symmetric session key does. A
// revoked collaborator who cached vN's session key cannot read vN+1.
const NewVersionInitSchema = z.object({
  action: z.literal("new-version-init"),
  fileId: z.string().uuid(),
  encryptedMetadata: z.string().min(1),
  totalSizeBytes: z.number().positive(),
  chunkCount: z.number().int().positive(),
  encryptedSessionKeyByFile: z.string().min(1),
  sessionKeyNonce: z.string(),
  // When the file has a parent, the client re-wraps its
  // `parent_keys_claim` so inherited-access readers get the NEW
  // session key in the claim (the hier keypair is unchanged). Root
  // files omit both fields.
  parentKeysClaim: z.string().min(1).nullable().optional(),
  parentKeysClaimWrappedBy: z.string().min(1).nullable().optional(),
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
        publicKemHierarchicalKey: data.publicKemHierarchicalKey,
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
        encryptedSessionKeyByFile: data.encryptedSessionKeyByFile,
        sessionKeyNonce: data.sessionKeyNonce,
        // Store PKC on the version row too so a future restore can
        // copy it back to the files row — restore needs the claim
        // wrapped under THIS version's session key to keep inherited
        // readers in sync after the session key rotates.
        parentKeysClaim: data.parentKeysClaim ?? null,
        parentKeysClaimWrappedBy: data.parentKeysClaimWrappedBy ?? null,
      });

      // Generate presigned URLs for all chunks. Storage keys include
      // the version id so multiple versions of the same file coexist
      // in R2 without collisions. Shard (= bucket) is round-robin by
      // sequence — the URL's hostname carries the bucket name so the
      // client transparently hits the right one.
      const chunkUrls: { sequence: number; shard: number; storageKey: string; uploadUrl: string }[] = [];
      for (let i = 0; i < data.chunkCount; i++) {
        const shard = shardForChunk(i);
        const storageKey = `${session.userId}/${file.id}/v${version.version_number}/chunk-${i}`;
        const uploadUrl = await getUploadUrl(shard, storageKey);
        chunkUrls.push({ sequence: i, shard, storageKey, uploadUrl });
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
        encryptedSessionKeyByFile: data.encryptedSessionKeyByFile,
        sessionKeyNonce: data.sessionKeyNonce,
        parentKeysClaim: data.parentKeysClaim ?? null,
        parentKeysClaimWrappedBy: data.parentKeysClaimWrappedBy ?? null,
      });

      const chunkUrls: { sequence: number; shard: number; storageKey: string; uploadUrl: string }[] = [];
      for (let i = 0; i < data.chunkCount; i++) {
        const shard = shardForChunk(i);
        const storageKey = `${session.userId}/${data.fileId}/v${version.version_number}/chunk-${i}`;
        const uploadUrl = await getUploadUrl(shard, storageKey);
        chunkUrls.push({ sequence: i, shard, storageKey, uploadUrl });
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

    // ─── REFRESH URLS ───
    // Mint fresh presigned URLs for specific chunks whose originals
    // expired. The storage-key format must match what /init and
    // /new-version-init generate — keep it centralized here so a
    // future prefix change only needs one edit.
    if (body.action === "refresh-urls") {
      const parsed = RefreshUrlsSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid data" }, { status: 400 });
      }
      const data = parsed.data;

      // Owner check. Non-owners never have an upload in flight so
      // there's no legitimate reason to refresh a URL here.
      const { data: file } = await supabase
        .from("files")
        .select("id, owner_id")
        .eq("id", data.fileId)
        .eq("owner_id", session.userId)
        .single();
      if (!file) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }

      // Resolve the version number for the storage-key prefix. If the
      // client supplied versionId, trust it (and validate it belongs
      // to this file); otherwise default to v1.
      let versionNumber = 1;
      if (data.versionId) {
        const { data: version } = await supabase
          .from("file_versions")
          .select("version_number")
          .eq("id", data.versionId)
          .eq("file_id", data.fileId)
          .single();
        if (!version) {
          return NextResponse.json({ error: "Version not found" }, { status: 404 });
        }
        versionNumber = version.version_number as number;
      }

      const chunkUrls: { sequence: number; shard: number; storageKey: string; uploadUrl: string }[] = [];
      for (const i of data.chunkIndexes) {
        const shard = shardForChunk(i);
        const storageKey = `${session.userId}/${data.fileId}/v${versionNumber}/chunk-${i}`;
        const uploadUrl = await getUploadUrl(shard, storageKey);
        chunkUrls.push({ sequence: i, shard, storageKey, uploadUrl });
      }

      return NextResponse.json({ chunkUrls });
    }

    // ─── FINALIZE ───
    if (body.action === "finalize") {
      const parsed = FinalizeSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid data" }, { status: 400 });
      }
      const { fileId, versionId, chunks: submittedChunks } = parsed.data;

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

      // Validate the shard mapping for every submitted chunk. Re-derive
      // from sequence on the server so a malicious client can't record
      // a chunk in the wrong bucket (would cause "missing chunk" at
      // download time). Cheap loop; bails early on first mismatch.
      for (const c of submittedChunks) {
        if (c.shard !== shardForChunk(c.sequence)) {
          return NextResponse.json(
            { error: `Shard mismatch at sequence ${c.sequence}` },
            { status: 400 },
          );
        }
      }

      // Two paths:
      //   - Initial v1 upload: versionId absent. Chunks belong to v1.
      //     Flip upload_complete.
      //   - New version upload: versionId present. Chunks belong to
      //     that version. Bump current_version_number + version_count
      //     and update the denormalized metadata on `files` so listings
      //     reflect the new version.
      if (versionId) {
        const { data: version } = await supabase
          .from("file_versions")
          .select("chunk_count, version_number, size_bytes, encrypted_metadata, encrypted_session_key_by_file, session_key_nonce, parent_keys_claim, parent_keys_claim_wrapped_by")
          .eq("id", versionId)
          .eq("file_id", fileId)
          .single();
        if (!version) {
          return NextResponse.json({ error: "Version not found" }, { status: 404 });
        }

        if (submittedChunks.length !== version.chunk_count) {
          return NextResponse.json(
            { error: "Chunk count mismatch" },
            { status: 400 },
          );
        }

        // Bulk insert chunks. Replaces the per-chunk action:"chunk"
        // round-trips the client used to make (~330 ms each). Atomic
        // insert; any failure leaves the DB clean (no chunks recorded
        // for this version, cleanup-stale picks up orphan R2 blobs).
        const { error: insChunksErr } = await supabase.from("file_chunks").insert(
          submittedChunks.map((c) => ({
            file_id: fileId,
            version_id: versionId,
            sequence: c.sequence,
            is_final: c.isFinal,
            size_bytes: c.sizeBytes,
            storage_key: c.storageKey,
            encryption_nonce: c.encryptionNonce,
            shard: c.shard,
          })),
        );
        if (insChunksErr) throw insChunksErr;

        // Commit: point `files` at the new version so list endpoints
        // render the new metadata immediately. version_count is an
        // authoritative count derived by +1 from before; the sql
        // DEFAULT 1 is for backfilled rows.
        // Compose the files-row update. parent_keys_claim is only
        // touched when the new version carried one (parented file);
        // root files leave the column as-is (it's NULL there anyway).
        const fileUpdate: Record<string, unknown> = {
          current_version_number: version.version_number,
          version_count: (file.current_version_number as number) + 1 === version.version_number
            ? (file.current_version_number as number) + 1
            : version.version_number,
          encrypted_metadata: version.encrypted_metadata,
          size_bytes: version.size_bytes,
          chunk_count: version.chunk_count,
          // Phase 4: mirror the new version's session-key wrap up
          // to the files row so list/download flows decrypt with
          // the CURRENT version's key (not the stale v1 one).
          encrypted_session_key_by_file: version.encrypted_session_key_by_file,
          session_key_nonce: version.session_key_nonce,
          updated_at: new Date().toISOString(),
        };
        if (version.parent_keys_claim && version.parent_keys_claim_wrapped_by) {
          // Re-wrapped parent_keys_claim for inherited-access readers.
          // Without this, workspace editors accessing via inheritance
          // would pull the stale session key out of the claim and
          // fail "invalid tag" decrypting the new metadata.
          fileUpdate.parent_keys_claim = version.parent_keys_claim;
          fileUpdate.parent_keys_claim_wrapped_by = version.parent_keys_claim_wrapped_by;
        }
        const { error: finalizeErr } = await supabase
          .from("files")
          .update(fileUpdate)
          .eq("id", fileId)
          .eq("owner_id", session.userId);
        if (finalizeErr) throw finalizeErr;

        // New-version landed — workspace members see the updated
        // name/size/metadata without waiting on polling. Fires the
        // generic file.new_version event (not file.created so the
        // client can distinguish "brand new file" from "existing
        // file updated" if it wants to).
        await broadcastFileMutation(fileId, "file.new_version");

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

      // Initial v1 finalize: chunks belong to v1. Validate count
      // against the declared chunk_count on the files row, then
      // bulk-insert and flip upload_complete.
      if (submittedChunks.length !== file.chunk_count) {
        return NextResponse.json({ error: "Chunk count mismatch" }, { status: 400 });
      }

      // Resolve v1's id so chunks link to the correct version row.
      const { data: v1 } = await supabase
        .from("file_versions")
        .select("id")
        .eq("file_id", fileId)
        .eq("version_number", 1)
        .single();
      const v1Id = v1?.id as string | undefined;

      const { error: insChunksErr } = await supabase.from("file_chunks").insert(
        submittedChunks.map((c) => ({
          file_id: fileId,
          version_id: v1Id ?? null,
          sequence: c.sequence,
          is_final: c.isFinal,
          size_bytes: c.sizeBytes,
          storage_key: c.storageKey,
          encryption_nonce: c.encryptionNonce,
          shard: c.shard,
        })),
      );
      if (insChunksErr) throw insChunksErr;

      const { error: finalizeErr } = await supabase
        .from("files")
        .update({ upload_complete: true })
        .eq("id", fileId)
        .eq("owner_id", session.userId);
      if (finalizeErr) throw finalizeErr;

      // Broadcast to the file's workspace so other members' drives
      // pick up the new row without polling. parent_id tells the
      // client which folder view should append the row. Fire-and-
      // forget: if the broadcast fails, polling/focus-refresh
      // still surfaces the change later.
      const { data: finalRow } = await supabase
        .from("files")
        .select("workspace_id, parent_id")
        .eq("id", fileId)
        .single();
      if (finalRow?.workspace_id) {
        await broadcast(
          channelForWorkspace(finalRow.workspace_id as string),
          "file.created",
          { fileId, parentId: finalRow.parent_id ?? null },
        );
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    logError("chunk-upload", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
