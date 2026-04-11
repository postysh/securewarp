import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getOwnedFile } from "@/lib/db/files";
import { supabase } from "@/lib/db/supabase";
import { deleteBlob } from "@/lib/db/r2";
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
  encryptedSessionKeyByFile: z.string().min(1),
  sessionKeyNonce: z.string().min(1),
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

    // Fetch OLD chunk storage keys so we can delete their R2 blobs
    // *after* the DB transaction commits — if anything fails before
    // commit, the old blobs stay in place and the file remains readable.
    const { data: oldChunks } = await supabase
      .from("file_chunks")
      .select("storage_key")
      .eq("file_id", file.id);
    const oldStorageKeys = ((oldChunks as { storage_key: string }[]) ?? [])
      .map((c) => c.storage_key)
      .filter((k): k is string => !!k);

    // ── mutation sequence ───────────────────────────────────────────
    // Supabase service-role client doesn't expose real transactions
    // from JS; we sequence carefully and log partial failures. For
    // Phase 5 v1 this is acceptable — the read path continues to
    // work on the old state until the files row flips, and the new
    // file_keys rows are idempotent upserts.

    const { error: filesErr } = await supabase
      .from("files")
      .update({
        encrypted_metadata: data.encryptedMetadata,
        public_hierarchical_key: data.publicHierarchicalKey,
        encrypted_session_key_by_file: data.encryptedSessionKeyByFile,
        session_key_nonce: data.sessionKeyNonce,
        parent_keys_claim: data.parentKeysClaim ?? null,
        parent_keys_claim_wrapped_by: data.parentKeysClaimWrappedBy ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", file.id);
    if (filesErr) throw filesErr;

    const { error: delChunksErr } = await supabase
      .from("file_chunks")
      .delete()
      .eq("file_id", file.id);
    if (delChunksErr) throw delChunksErr;

    const { error: insChunksErr } = await supabase.from("file_chunks").insert(
      data.newChunks.map((c) => ({
        file_id: file.id,
        sequence: c.sequence,
        is_final: c.isFinal,
        size_bytes: c.sizeBytes,
        storage_key: c.storageKey,
        encryption_nonce: c.encryptionNonce,
      }))
    );
    if (insChunksErr) throw insChunksErr;

    const { error: revokeErr } = await supabase
      .from("file_keys")
      .delete()
      .eq("file_id", file.id)
      .eq("user_id", data.revokedUserId);
    if (revokeErr) throw revokeErr;

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

    // Fire-and-forget blob cleanup — don't block the response on R2.
    void Promise.allSettled(oldStorageKeys.map((k) => deleteBlob(k))).then(
      (results) => {
        const failures = results.filter((r) => r.status === "rejected").length;
        if (failures > 0) {
          logError("files.rotate-commit.orphan-blobs", { failures, total: oldStorageKeys.length });
        }
      }
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.rotate-commit", err);
    return NextResponse.json({ error: "Rotate failed" }, { status: 500 });
  }
}
