import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getOwnedFile, revokeLinksCreatedByInSubtree } from "@/lib/db/files";
import { supabase } from "@/lib/db/supabase";
import { deleteBlobs, shardForChunk, measureBlobSizes } from "@/lib/db/r2";
import { parseChunkStorageKey } from "@/lib/db/storage-key";
import { assertWithinQuota } from "@/lib/db/quota";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

const ParamSchema = z.object({ id: z.string().uuid() });

const NewChunkSchema = z.object({
  sequence: z.number().int().min(0),
  storageKey: z.string().min(1),
  encryptionNonce: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  isFinal: z.boolean(),
});

const CollaboratorSchema = z.object({
  userId: z.string().uuid(),
  encryptedPrivateHierarchicalKey: z.string().min(1),
  wrappedByPublicKey: z.string().min(1),
  permissionLevel: z.enum(["owner", "editor", "viewer"]),
});

const CommitSchema = z.object({
  encryptedMetadata: z.string().min(1),
  publicHierarchicalKey: z.string().min(1),
  publicKemHierarchicalKey: z.string().min(1),
  encryptedSessionKeyByFile: z.string().min(1),
  sessionKeyNonce: z.string(),
  parentKeysClaim: z.string().min(1).nullable().optional(),
  parentKeysClaimWrappedBy: z.string().min(1).nullable().optional(),
  newChunks: z.array(NewChunkSchema).min(1),
  remainingCollaborators: z.array(CollaboratorSchema),
  revokedUserId: z.string().uuid(),
});

/**
 * Phase 5 rotate-commit — owner-gated. Atomically swaps:
 *
 *   - the file's hierarchical keypair + session-key wrap
 *   - optional parent_keys_claim re-wrap
 *   - every file_chunks row (the new R2 blobs were already uploaded
 *     during /rotate-init; this replaces the DB pointer set)
 *   - every remaining collaborator's file_keys row (new priv hier wrap)
 *   - deletes the revoked user's file_keys row
 *
 * Guard: the provided `remainingCollaborators ∪ {revokedUserId}` must
 * exactly equal the file's current file_keys set. Prevents a malicious
 * or buggy client from sneaking in an extra grant or omitting an
 * existing collaborator through this path.
 *
 * After the DB side commits, the old R2 chunk blobs are fire-and-forget
 * deleted. If the deletion partially fails the DB is still consistent;
 * the orphan blobs can be swept by a future cleanup pass.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const parsedId = ParamSchema.safeParse({ id });
    if (!parsedId.success) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = CommitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid rotate payload" }, { status: 400 });
    }
    const data = parsed.data;

    const file = await getOwnedFile(parsedId.data.id, session.userId);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (file.is_folder) {
      return NextResponse.json(
        { error: "Folder rotation isn't supported yet" },
        { status: 400 }
      );
    }
    if (data.revokedUserId === session.userId) {
      return NextResponse.json(
        { error: "Cannot revoke yourself as the owner" },
        { status: 400 }
      );
    }

    // Guard — current ACL set must equal remaining + revoked.
    const { data: currentKeys, error: keysErr } = await supabase
      .from("file_keys")
      .select("user_id")
      .eq("file_id", file.id);
    if (keysErr) throw keysErr;

    const current = new Set(
      ((currentKeys as { user_id: string }[]) ?? []).map((r) => r.user_id)
    );
    const proposed = new Set<string>([
      ...data.remainingCollaborators.map((c) => c.userId),
      data.revokedUserId,
    ]);
    if (current.size !== proposed.size || [...current].some((u) => !proposed.has(u))) {
      return NextResponse.json(
        {
          error:
            "Collaborator set changed during rotate — retry with a fresh list",
        },
        { status: 409 }
      );
    }
    if (!current.has(data.revokedUserId)) {
      return NextResponse.json(
        { error: "User is not a collaborator on this file" },
        { status: 400 }
      );
    }
    if (!data.remainingCollaborators.some((c) => c.userId === session.userId)) {
      return NextResponse.json(
        { error: "Owner must remain in the collaborator set" },
        { status: 400 }
      );
    }
    // `proposed` is a Set, so a payload that lists the revoked user in
    // `remainingCollaborators` too would pass the equality check and
    // then re-grant them the NEW private hier key while the audit log
    // records a revocation. Reject it explicitly.
    if (data.remainingCollaborators.some((c) => c.userId === data.revokedUserId)) {
      return NextResponse.json(
        { error: "Revoked user cannot also be in the remaining set" },
        { status: 400 }
      );
    }

    // Fetch OLD chunk (shard, storage_key) pairs + version rows so
    // we can clean them up AFTER the new state commits. If anything
    // fails mid-sequence, the old state stays readable until the
    // files row flips (step 5 below).
    const { data: oldChunks } = await supabase
      .from("file_chunks")
      .select("storage_key, shard")
      .eq("file_id", file.id);
    const oldOrphanedChunks = ((oldChunks as { storage_key: string; shard: number | null }[]) ?? [])
      .filter((c) => !!c.storage_key)
      .map((c) => ({ storageKey: c.storage_key, shard: c.shard ?? 0 }));

    // Storage-key binding. `file_chunks.storage_key` is trusted
    // verbatim by chunk-download (presigned GET) and by every blob
    // delete path, so a key recorded here MUST have been minted by
    // rotate-init for THIS caller and THIS file — otherwise the owner
    // of a throwaway file could point it at another tenant's blob,
    // read it, and then destroy it by emptying trash. rotate-init's
    // tag is a timestamp we don't persist, so we can't recompute the
    // exact key; binding owner + file + sequence is sufficient to
    // rule out every foreign reference. We additionally require one
    // tag across the payload, unique sequences, and no overlap with
    // the chunk set we're about to delete (step 5 would otherwise
    // remove blobs the new rows point at).
    const oldKeySet = new Set(oldOrphanedChunks.map((c) => c.storageKey));
    const seenSequences = new Set<number>();
    let rotationTag: string | null = null;
    for (const c of data.newChunks) {
      const parsed = parseChunkStorageKey(c.storageKey);
      if (
        !parsed ||
        parsed.ownerUserId !== session.userId ||
        parsed.fileId !== file.id ||
        parsed.sequence !== c.sequence
      ) {
        return NextResponse.json(
          { error: `Storage key mismatch at sequence ${c.sequence}` },
          { status: 400 }
        );
      }
      if (rotationTag === null) rotationTag = parsed.versionTag;
      if (parsed.versionTag !== rotationTag) {
        return NextResponse.json(
          { error: "All chunks must belong to one rotation" },
          { status: 400 }
        );
      }
      if (seenSequences.has(c.sequence)) {
        return NextResponse.json(
          { error: `Duplicate chunk sequence ${c.sequence}` },
          { status: 400 }
        );
      }
      seenSequences.add(c.sequence);
      if (oldKeySet.has(c.storageKey)) {
        return NextResponse.json(
          { error: "Rotation must not reuse the current version's storage keys" },
          { status: 400 }
        );
      }
    }

    // Measure the rotated blobs in R2 and enforce quota on the REAL
    // total. `sizeBytes` in the body is the client's word and the
    // presigned PUT has no Content-Length condition; recording it
    // would let an owner store unlimited bytes at a declared 1 byte
    // per rotation. Same rule as chunk-upload finalize. Runs before
    // any mutation so a rejection leaves the file untouched; the new
    // blobs are removed (best-effort) so they can't be parked in R2.
    const newItems = data.newChunks.map((c) => ({
      shard: shardForChunk(c.sequence),
      storageKey: c.storageKey,
    }));
    const measured = await measureBlobSizes(newItems);
    const measuredSizes: number[] = [];
    let measuredTotal = 0;
    for (const c of data.newChunks) {
      const size = measured.get(c.storageKey);
      if (size === undefined) {
        return NextResponse.json(
          { error: `Chunk ${c.sequence} was not uploaded` },
          { status: 400 }
        );
      }
      measuredSizes.push(size);
      measuredTotal += size;
    }
    try {
      await assertWithinQuota(session.userId, measuredTotal, {
        replacesFileId: file.id,
        skipFileCount: true,
      });
    } catch (e) {
      try {
        await deleteBlobs(newItems);
      } catch (err) {
        logError("files.rotate-commit.quota-cleanup", { fileId: file.id, err });
      }
      const status = (e as { status?: number }).status ?? 500;
      return NextResponse.json({ error: (e as Error).message }, { status });
    }

    // ── mutation sequence ───────────────────────────────────────────
    // Rotation wipes the past: a revoked collaborator's cached
    // session key / priv hier can still decrypt whatever they
    // already downloaded, but the file server-side is now a fresh
    // era. Historical file_versions rows were wrapped under the OLD
    // hier keypair which no longer exists on the files row — they
    // would be un-decryptable going forward, so we delete them
    // rather than leave a trail of corrupt version history.
    //
    // Order matters for idempotent retry if any step crashes:
    //   1. Figure out the next version number (max + 1, monotonic).
    //   2. Insert a fresh file_versions row for the rotated content.
    //   3. Insert new file_chunks linked to that version_id. At
    //      this point both old and new chunk sets exist — readers
    //      still see the old state because files.current_version_number
    //      hasn't been flipped yet.
    //   4. Flip files.current_version_number + all rotated fields.
    //      Readers now resolve to the new version.
    //   5. Clean up: delete old file_versions rows (NOT the new one)
    //      and old file_chunks rows (not the new ones).
    //   6. Upsert the remaining collaborators' new priv-hier wraps.
    //   7. Delete the revoked user's file_keys row — LAST.
    //
    // 6 before 7 is load-bearing: the files row already carries the
    // NEW pub hier key after step 4, so until step 6 lands nobody can
    // unwrap it. If the revoked row were deleted first and the upsert
    // then failed, the guard above would reject every retry (the
    // proposed set is one larger than the current set) and the file
    // would be permanently undecryptable — including for the owner.
    // With the revoked row deleted last, a failure anywhere leaves the
    // current ACL set unchanged, so the identical payload passes the
    // guard on retry and every step is an idempotent upsert/update.

    // 1. Next monotonic version number.
    const { data: maxRow } = await supabase
      .from("file_versions")
      .select("version_number")
      .eq("file_id", file.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .single();
    const nextVersionNumber =
      ((maxRow?.version_number as number | undefined) ?? 0) + 1;

    // 2. Fresh file_versions row.
    const { data: newVersion, error: insVersionErr } = await supabase
      .from("file_versions")
      .insert({
        file_id: file.id,
        version_number: nextVersionNumber,
        encrypted_metadata: data.encryptedMetadata,
        size_bytes: measuredTotal,
        chunk_count: data.newChunks.length,
        created_by_user_id: session.userId,
        encrypted_session_key_by_file: data.encryptedSessionKeyByFile,
        session_key_nonce: data.sessionKeyNonce,
      })
      .select("id")
      .single();
    if (insVersionErr || !newVersion) throw insVersionErr ?? new Error("Failed to insert version row");

    const newVersionId = newVersion.id as string;

    // 3. Insert new chunks linked to the new version. Derive shard
    // from sequence — same rule rotate-init used when minting the
    // upload URLs, so the blobs that were uploaded under bucket
    // shard-N are recorded with shard=N in the DB.
    const { error: insChunksErr } = await supabase.from("file_chunks").insert(
      data.newChunks.map((c, i) => ({
        file_id: file.id,
        version_id: newVersionId,
        sequence: c.sequence,
        is_final: c.isFinal,
        size_bytes: measuredSizes[i],
        storage_key: c.storageKey,
        encryption_nonce: c.encryptionNonce,
        shard: shardForChunk(c.sequence),
      }))
    );
    if (insChunksErr) throw insChunksErr;

    // 4. Flip files row — readers now see the new state.
    const { error: filesErr } = await supabase
      .from("files")
      .update({
        encrypted_metadata: data.encryptedMetadata,
        public_hierarchical_key: data.publicHierarchicalKey,
        public_kem_hierarchical_key: data.publicKemHierarchicalKey,
        encrypted_session_key_by_file: data.encryptedSessionKeyByFile,
        session_key_nonce: data.sessionKeyNonce,
        parent_keys_claim: data.parentKeysClaim ?? null,
        parent_keys_claim_wrapped_by: data.parentKeysClaimWrappedBy ?? null,
        current_version_number: nextVersionNumber,
        version_count: 1,
        chunk_count: data.newChunks.length,
        size_bytes: measuredTotal,
        updated_at: new Date().toISOString(),
      })
      .eq("id", file.id);
    if (filesErr) throw filesErr;

    // 5a. Delete old chunks (all rows for this file_id except the
    //     new ones we just inserted).
    const { error: delChunksErr } = await supabase
      .from("file_chunks")
      .delete()
      .eq("file_id", file.id)
      .neq("version_id", newVersionId);
    if (delChunksErr) throw delChunksErr;

    // 5b. Delete old file_versions rows. Historical wraps are now
    //     un-decryptable (they used the discarded hier keypair) so
    //     retaining them would just be noise.
    const { error: delVersionsErr } = await supabase
      .from("file_versions")
      .delete()
      .eq("file_id", file.id)
      .neq("id", newVersionId);
    if (delVersionsErr) throw delVersionsErr;

    // 6. Upsert remaining collaborators' new priv-hier wraps.
    const { error: upsertErr } = await supabase.from("file_keys").upsert(
      data.remainingCollaborators.map((c) => ({
        file_id: file.id,
        user_id: c.userId,
        encrypted_private_hierarchical_key: c.encryptedPrivateHierarchicalKey,
        wrapped_by_public_key: c.wrappedByPublicKey,
        permission_level: c.permissionLevel,
      })),
      { onConflict: "file_id,user_id" }
    );
    if (upsertErr) throw upsertErr;

    // 7. Delete revoked user — last, see the ordering note above.
    const { error: revokeErr } = await supabase
      .from("file_keys")
      .delete()
      .eq("file_id", file.id)
      .eq("user_id", data.revokedUserId);
    if (revokeErr) throw revokeErr;

    // Public links the revoked user minted are cryptographically dead
    // (they wrap the OLD private hier key) but would still show as
    // active in the link list. Mark them revoked so the UI and the
    // anonymous routes agree.
    await revokeLinksCreatedByInSubtree(file.id, data.revokedUserId);

    // Fire-and-forget blob cleanup — don't block the response on R2.
    // `deleteBlobs` groups by shard and issues one S3 DeleteObjects
    // per bucket.
    void deleteBlobs(oldOrphanedChunks).catch((err) => {
      logError("files.rotate-commit.orphan-blobs", {
        total: oldOrphanedChunks.length,
        err,
      });
    });

    auditEvent({
      event: "files.rotate",
      actorUserId: session.userId,
      targetFileId: file.id,
      targetUserId: data.revokedUserId,
      detail: `remaining=${data.remainingCollaborators.length}`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.rotate-commit", err);
    return NextResponse.json({ error: "Rotate failed" }, { status: 500 });
  }
}
