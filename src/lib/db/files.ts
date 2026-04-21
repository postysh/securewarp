import "server-only";
import { supabase } from "./supabase";

export interface FileRow {
  id: string;
  owner_id: string;
  parent_id: string | null;
  encrypted_metadata: string;
  is_folder: boolean;
  size_bytes: number;
  storage_key: string | null;
  encryption_nonce: string | null;
  upload_complete: boolean;
  // Phase 2 — hierarchical keypair per file (Skiff model).
  // Every file has a dedicated asymmetric keypair. The session key is
  // wrapped once to this public key; each collaborator's file_keys row
  // then wraps the *private* hierarchical key to that collaborator's
  // public encryption key. Adding a collaborator is O(1) regardless of
  // file size.
  public_hierarchical_key: string;
  // Crypto v2 Phase 2b — ML-KEM-768 public hierarchical key. Paired
  // with `public_hierarchical_key` (X25519 half) for the hybrid wrap.
  public_kem_hierarchical_key: string;
  encrypted_session_key_by_file: string;
  // v2 note: the hybrid blob embeds the nonce, so `session_key_nonce`
  // is stored as an empty string for v2 writes and ignored by the
  // unwrap path. A later migration drops this column; kept on the
  // type + DB for backward compat during the rollout.
  session_key_nonce: string;
  // Phase 3 — folder inheritance. When this file has a parent, the
  // claim wraps {sessionKey, childPrivateHierarchicalKey} under the
  // parent's public hierarchical key. Anyone holding the parent's
  // private hier key can unwrap descendants transitively. NULL for
  // root items.
  parent_keys_claim: string | null;
  parent_keys_claim_wrapped_by: string | null;
  deleted_at: string | null;
  is_workspace_root: boolean;
  workspace_id: string | null;
  // Monotonic version pointer. Bumped on every new-version finalize
  // and on restore. Phase 4 — used by chunk-download to filter
  // file_chunks to the current version's rows only.
  current_version_number: number;
  version_count: number;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

// Shape returned by list/get endpoints. `encrypted_private_hierarchical_key`
// is the caller's per-user wrap (from their file_keys row); the session key
// is decrypted by first unwrapping the hierarchical private key, then using
// it to unwrap `encrypted_session_key_by_file` via box(owner.pub, file.priv).
export type FileRowWithKey = FileRow & {
  encrypted_private_hierarchical_key: string;
  // Sharer's X25519 public key at the time of the grant — the ECDH
  // sender half of the hybrid wrap. ML-KEM half is encapsulated
  // in-blob, so no sender_public_kem_key is needed.
  wrapped_by_public_key: string;
  // Owner's current X25519 + ML-KEM-768 public keys, needed for
  // the session-key unwrap step (hybrid wrap pairs both halves).
  owner_public_key: string;
  owner_public_kem_key: string;
};

export interface FileKeyRow {
  file_id: string;
  user_id: string;
  encrypted_private_hierarchical_key: string;
  wrapped_by_public_key: string;
}

export interface FileVersionRow {
  id: string;
  file_id: string;
  version_number: number;
  encrypted_metadata: string;
  size_bytes: number;
  chunk_count: number;
  created_at: string;
  created_by_user_id: string | null;
  // Crypto v2 Phase 4 — per-version session key. Every new-version
  // upload generates a fresh session key, wrapped to the file's
  // existing pub hier keys. Old versions keep their historical wraps
  // so listVersions still resolves. `session_key_nonce` is empty for
  // v2 wraps (hybrid blob embeds its own nonce).
  encrypted_session_key_by_file: string;
  session_key_nonce: string | null;
  // Staging area for the new-version-init → finalize handoff. Only
  // populated for the in-flight "new version of a parented file";
  // finalize mirrors these to the files row and they become dead
  // data on the version row once older versions supersede.
  parent_keys_claim: string | null;
  parent_keys_claim_wrapped_by: string | null;
}

/**
 * Create a new version row for a file. v1 is created automatically as
 * part of the initial upload flow; v2+ are created when a user uploads
 * a replacement of existing content.
 *
 * Crypto v2 Phase 4: every version carries its own session-key wrap.
 * v1 reuses the wrap the upload flow already wrote to the files row;
 * v2+ generate a fresh session key on the client and ship its wrap
 * here. The file's hierarchical keypair is unchanged across versions
 * (so file_keys rows stay valid), only the symmetric session key
 * rotates.
 */
export async function createFileVersion(data: {
  fileId: string;
  versionNumber: number;
  encryptedMetadata: string;
  sizeBytes: number;
  chunkCount: number;
  createdByUserId: string;
  encryptedSessionKeyByFile: string;
  sessionKeyNonce: string;
  // Only set for new-version uploads on a parented file; finalize
  // mirrors the pair to the files row so inherited-access readers
  // pick up the re-wrapped claim.
  parentKeysClaim?: string | null;
  parentKeysClaimWrappedBy?: string | null;
}): Promise<FileVersionRow> {
  const { data: row, error } = await supabase
    .from("file_versions")
    .insert({
      file_id: data.fileId,
      version_number: data.versionNumber,
      encrypted_metadata: data.encryptedMetadata,
      size_bytes: data.sizeBytes,
      chunk_count: data.chunkCount,
      created_by_user_id: data.createdByUserId,
      encrypted_session_key_by_file: data.encryptedSessionKeyByFile,
      session_key_nonce: data.sessionKeyNonce,
      parent_keys_claim: data.parentKeysClaim ?? null,
      parent_keys_claim_wrapped_by: data.parentKeysClaimWrappedBy ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create file version: ${error.message}`);
  return row as FileVersionRow;
}

/**
 * List every version of a file in newest-first order. Caller is
 * responsible for verifying the user has access to the file — this
 * helper returns all versions unconditionally so it can be reused by
 * admin paths without a second access check.
 */
export async function listFileVersions(fileId: string): Promise<FileVersionRow[]> {
  const { data, error } = await supabase
    .from("file_versions")
    .select("*")
    .eq("file_id", fileId)
    .order("version_number", { ascending: false });
  if (error) throw new Error(`Failed to list versions: ${error.message}`);
  return (data as FileVersionRow[]) ?? [];
}

export async function getFileVersion(id: string): Promise<FileVersionRow | null> {
  const { data, error } = await supabase
    .from("file_versions")
    .select("*")
    .eq("id", id)
    .single();
  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch version: ${error.message}`);
  }
  return (data as FileVersionRow | null) || null;
}

/**
 * Restore a file to the content of an older version. Creates a NEW
 * version row (next monotonic number) whose content matches `source`
 * — metadata, size, chunk count all copied — and duplicates every
 * file_chunks row under the new version_id. R2 blobs are SHARED
 * between the source and new version (same storage_key); delete-
 * version paths must ref-count before purging blobs.
 *
 * Returns the newly-created version row so the caller can bump
 * files.current_version_number to it.
 */
export async function restoreFileVersion(params: {
  fileId: string;
  sourceVersionId: string;
  actorUserId: string;
}): Promise<FileVersionRow> {
  // Load the source version + its chunks.
  const { data: source, error: sourceErr } = await supabase
    .from("file_versions")
    .select("*")
    .eq("id", params.sourceVersionId)
    .eq("file_id", params.fileId)
    .single();
  if (sourceErr || !source) {
    throw new Error("Source version not found");
  }

  const { data: sourceChunks, error: chunksErr } = await supabase
    .from("file_chunks")
    .select("sequence, is_final, size_bytes, storage_key, encryption_nonce")
    .eq("version_id", params.sourceVersionId)
    .order("sequence");
  if (chunksErr) throw new Error(chunksErr.message);

  // Find the highest existing version_number for this file so we can
  // allocate the next one atomically-enough. There's a TOCTOU here —
  // two concurrent restores could race to the same number and one
  // would fail the UNIQUE constraint. That's acceptable: the client
  // retries and the second call wins. Restore is a rare, user-
  // initiated action; a hot spin-lock would be overkill.
  const { data: maxRow } = await supabase
    .from("file_versions")
    .select("version_number")
    .eq("file_id", params.fileId)
    .order("version_number", { ascending: false })
    .limit(1)
    .single();
  const nextNumber =
    ((maxRow?.version_number as number | undefined) ?? 0) + 1;

  // Phase 4 — restore copies the source version's session-key wrap
  // along with the metadata + chunks. This is a deliberate tradeoff:
  // the "restored" version reuses the source version's session key,
  // so forward-secrecy against the source version is not preserved
  // for restored content. Acceptable because restore is a rare,
  // user-initiated action and the alternative (client download +
  // fresh re-upload) doubles R2 egress on every restore. Documented
  // in AGENTS.md.
  const newVersion = await createFileVersion({
    fileId: params.fileId,
    versionNumber: nextNumber,
    encryptedMetadata: source.encrypted_metadata as string,
    sizeBytes: source.size_bytes as number,
    chunkCount: source.chunk_count as number,
    createdByUserId: params.actorUserId,
    encryptedSessionKeyByFile: source.encrypted_session_key_by_file as string,
    sessionKeyNonce: (source.session_key_nonce as string | null) ?? "",
  });

  if (sourceChunks && sourceChunks.length > 0) {
    const rows = sourceChunks.map((c) => ({
      file_id: params.fileId,
      version_id: newVersion.id,
      sequence: c.sequence,
      is_final: c.is_final,
      size_bytes: c.size_bytes,
      // Shared R2 blob — same storage_key. When deleting this
      // version later, a reference count across file_chunks decides
      // whether to also purge the blob.
      storage_key: c.storage_key,
      encryption_nonce: c.encryption_nonce,
    }));
    const { error: insertErr } = await supabase.from("file_chunks").insert(rows);
    if (insertErr) throw new Error(insertErr.message);
  }

  return newVersion;
}

/**
 * Delete a specific version. The caller must ensure it's NOT the
 * current version (that's nonsensical — there'd be no "head" to show
 * in lists). Returns the storage_keys that became orphaned by this
 * delete so the caller can purge R2 blobs. Keys still referenced by
 * another version are filtered out.
 */
export async function deleteFileVersion(versionId: string): Promise<string[]> {
  // Pull the chunk rows for this version BEFORE deleting so we can
  // reference-count their storage_keys across remaining versions.
  const { data: chunks } = await supabase
    .from("file_chunks")
    .select("storage_key")
    .eq("version_id", versionId);

  const storageKeys = (chunks ?? [])
    .map((c) => c.storage_key as string)
    .filter(Boolean);

  // Delete the version row — file_chunks rows cascade.
  const { error } = await supabase.from("file_versions").delete().eq("id", versionId);
  if (error) throw new Error(error.message);

  if (storageKeys.length === 0) return [];

  // Ref-count: any storage_key still referenced by a different
  // version stays; the rest are orphaned and safe to purge from R2.
  const { data: stillRefed } = await supabase
    .from("file_chunks")
    .select("storage_key")
    .in("storage_key", storageKeys);
  const refedSet = new Set(
    (stillRefed ?? []).map((r) => r.storage_key as string),
  );
  return storageKeys.filter((k) => !refedSet.has(k));
}

export async function createFile(data: {
  ownerId: string;
  parentId: string | null;
  encryptedMetadata: string;
  isFolder: boolean;
  sizeBytes: number;
  storageKey: string | null;
  encryptionNonce?: string;
  publicHierarchicalKey: string;
  publicKemHierarchicalKey: string;
  encryptedSessionKeyByFile: string;
  sessionKeyNonce: string;
  // Phase 3. Required when parentId is non-null; must be null when
  // parentId is null. The route handler enforces this coupling.
  parentKeysClaim?: string | null;
  parentKeysClaimWrappedBy?: string | null;
  // Defaults to true so folders and any future single-shot uploads are
  // immediately visible. Chunked uploads pass false and flip it on finalize.
  uploadComplete?: boolean;
}): Promise<FileRow> {
  // Inherit workspace_id from parent folder
  let workspaceId: string | null = null;
  if (data.parentId) {
    const { data: parent } = await supabase
      .from("files")
      .select("workspace_id")
      .eq("id", data.parentId)
      .single();
    workspaceId = (parent?.workspace_id as string | null) ?? null;
  }

  const { data: file, error } = await supabase
    .from("files")
    .insert({
      owner_id: data.ownerId,
      parent_id: data.parentId,
      encrypted_metadata: data.encryptedMetadata,
      is_folder: data.isFolder,
      size_bytes: data.sizeBytes,
      storage_key: data.storageKey,
      encryption_nonce: data.encryptionNonce || null,
      upload_complete: data.uploadComplete ?? true,
      public_hierarchical_key: data.publicHierarchicalKey,
      public_kem_hierarchical_key: data.publicKemHierarchicalKey,
      encrypted_session_key_by_file: data.encryptedSessionKeyByFile,
      session_key_nonce: data.sessionKeyNonce,
      parent_keys_claim: data.parentKeysClaim ?? null,
      parent_keys_claim_wrapped_by: data.parentKeysClaimWrappedBy ?? null,
      workspace_id: workspaceId,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create file: ${error.message}`);
  return file;
}

export async function createFileKey(data: {
  fileId: string;
  userId: string;
  encryptedPrivateHierarchicalKey: string;
  wrappedByPublicKey: string;
}): Promise<void> {
  const { error } = await supabase
    .from("file_keys")
    .insert({
      file_id: data.fileId,
      user_id: data.userId,
      encrypted_private_hierarchical_key: data.encryptedPrivateHierarchicalKey,
      wrapped_by_public_key: data.wrappedByPublicKey,
      // createFileKey is only called from upload/folder creation paths,
      // which always create the owner's own row. Shared grants go through
      // grantFileAccess instead.
      permission_level: "owner",
    });

  if (error) throw new Error(`Failed to create file key: ${error.message}`);
}

// The PostgREST join pulls the caller's file_keys row (`encrypted_private_
// hierarchical_key` + `wrapped_by_public_key`) and the owner's public key
// from the `users` table.
type FileJoinRow = Record<string, unknown> & {
  file_keys: {
    encrypted_private_hierarchical_key: string;
    wrapped_by_public_key: string;
  }[];
  owner: { public_encryption_key: string; public_kem_key: string } | null;
};

function shapeRow(row: FileJoinRow): FileRowWithKey {
  const { file_keys, owner, ...rest } = row;
  const fk = file_keys[0];
  return {
    ...(rest as unknown as FileRow),
    encrypted_private_hierarchical_key: fk?.encrypted_private_hierarchical_key || "",
    wrapped_by_public_key: fk?.wrapped_by_public_key || "",
    owner_public_key: owner?.public_encryption_key || "",
    owner_public_kem_key: owner?.public_kem_key || "",
  };
}

const LIST_SELECT =
  "*, file_keys!inner(encrypted_private_hierarchical_key, wrapped_by_public_key)," +
  " owner:users!files_owner_id_fkey(public_encryption_key, public_kem_key)";

export const PAGE_SIZE = 100;

export async function getFilesForUser(
  userId: string,
  parentId: string | null,
  cursor?: string
): Promise<{ files: FileRowWithKey[]; nextCursor: string | null }> {
  // Own files only — scoped by owner_id. The file_keys join is still required
  // to surface the caller's wrapped hierarchical private key (which is stored
  // per-user even for the owner so owner and shared decrypt paths match).
  let query = supabase
    .from("files")
    .select(LIST_SELECT)
    .eq("owner_id", userId)
    .eq("file_keys.user_id", userId)
    .eq("upload_complete", true)
    .is("deleted_at", null);

  if (parentId) {
    query = query.eq("parent_id", parentId);
  } else {
    // Root listing — hide workspace root folders from personal view
    query = query.is("parent_id", null).eq("is_workspace_root", false);
  }

  // Cursor pagination: cursor is `created_at` of the last item.
  // Since we order by is_folder DESC, created_at DESC, we filter
  // items created before the cursor timestamp.
  if (cursor) {
    query = query.lt("created_at", cursor);
  }

  const { data, error } = await query
    .order("is_folder", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE + 1); // fetch one extra to detect hasMore

  if (error) throw new Error(`Failed to fetch files: ${error.message}`);
  const rows = (data || []).map((row) => shapeRow(row as unknown as FileJoinRow));
  const hasMore = rows.length > PAGE_SIZE;
  const files = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore && files.length > 0 ? files[files.length - 1].created_at : null;
  return { files, nextCursor };
}

/**
 * Files shared with a user by someone else. Flat list — there is no per-user
 * folder structure for Phase 1 sharing, shared items surface at the root of
 * the "Shared with me" view.
 */
export async function getSharedWithUser(userId: string): Promise<FileRowWithKey[]> {
  const { data, error } = await supabase
    .from("files")
    .select(LIST_SELECT)
    .eq("file_keys.user_id", userId)
    .neq("owner_id", userId)
    .eq("upload_complete", true)
    .is("deleted_at", null)
    .is("workspace_id", null)
    .eq("is_workspace_root", false)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(`Failed to fetch shared files: ${error.message}`);
  return (data || []).map((row) => shapeRow(row as unknown as FileJoinRow));
}

/**
 * Phase 3 — list children of a folder the caller has access to but does
 * not necessarily own. Used when a collaborator navigates into a shared
 * folder: every child may lack a direct file_keys row, so the caller
 * walks the parent_keys_claim chain client-side instead.
 *
 * Two-query design:
 *   1. Access check — caller must have a file_keys row on `parentId`.
 *      This is the gate for reading anything below the folder.
 *   2. Fetch all direct children regardless of their file_keys state.
 *   3. Left-merge the caller's own file_keys rows on those children so
 *      direct-row holders (owner, direct collaborators) keep the fast
 *      decrypt path.
 */
export async function getInheritedChildren(
  parentId: string,
  userId: string
): Promise<FileRowWithKey[]> {
  // 1. Lightweight access check + fetch children in parallel.
  // Instead of the full getFileById (joins file_keys + users), just
  // check if the caller owns the folder OR has a file_keys row on it.
  const [accessResult, childResult] = await Promise.all([
    supabase.from("file_keys").select("user_id").eq("file_id", parentId).eq("user_id", userId).single(),
    supabase
      .from("files")
      .select("*, owner:users!files_owner_id_fkey(public_encryption_key, public_kem_key)")
      .eq("parent_id", parentId)
      .eq("upload_complete", true)
      .is("deleted_at", null)
      .order("is_folder", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  // Access denied if no direct file_keys row — fall back to inherited permission
  if (!accessResult.data) {
    const perm = await getEffectivePermission(parentId, userId);
    if (!perm) return [];
  }
  const { data: files, error } = childResult;
  if (error) throw new Error(`Failed to fetch children: ${error.message}`);
  if (!files || files.length === 0) return [];

  // 2. Fetch caller's direct file_keys rows on these children
  const fileIds = (files as { id: string }[]).map((f) => f.id);
  const { data: ownRows, error: keysErr } = await supabase
    .from("file_keys")
    .select("file_id, encrypted_private_hierarchical_key, wrapped_by_public_key")
    .eq("user_id", userId)
    .in("file_id", fileIds);
  if (keysErr) throw new Error(`Failed to fetch file_keys: ${keysErr.message}`);

  const keyByFile = new Map(
    (ownRows as {
      file_id: string;
      encrypted_private_hierarchical_key: string;
      wrapped_by_public_key: string;
    }[]).map((r) => [r.file_id, r])
  );

  return (files as (FileRow & { owner: { public_encryption_key: string; public_kem_key: string } | null })[]).map(
    (f) => {
      const direct = keyByFile.get(f.id);
      const { owner, ...rest } = f;
      return {
        ...rest,
        encrypted_private_hierarchical_key: direct?.encrypted_private_hierarchical_key ?? "",
        wrapped_by_public_key: direct?.wrapped_by_public_key ?? "",
        owner_public_key: owner?.public_encryption_key ?? "",
        owner_public_kem_key: owner?.public_kem_key ?? "",
      };
    }
  );
}

export async function getFileById(
  fileId: string,
  userId: string
): Promise<FileRowWithKey | null> {
  const { data, error } = await supabase
    .from("files")
    .select(LIST_SELECT)
    .eq("id", fileId)
    .eq("file_keys.user_id", userId)
    .eq("upload_complete", true)
    .is("deleted_at", null)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch file: ${error.message}`);
  }
  if (!data) return null;
  return shapeRow(data as unknown as FileJoinRow);
}

/**
 * Confirm a file exists and is owned by the given user. Used to gate
 * share/unshare operations — only the owner can grant or revoke access.
 */
export async function getOwnedFile(fileId: string, ownerId: string): Promise<FileRow | null> {
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("id", fileId)
    .eq("owner_id", ownerId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to load file: ${error.message}`);
  }
  return (data as FileRow) || null;
}

/**
 * Grant a collaborator access to a file by inserting (or updating) their
 * wrapped hierarchical-private-key row. Idempotent on (file_id, user_id).
 *
 * `wrappedByPublicKey` is the sharer's public encryption key at the time of
 * the grant — the recipient uses it as the nacl.box sender to unwrap the
 * hierarchical private key. For owner-initiated grants this is the owner.
 * For non-owner re-shares (Phase 2), this is whichever collaborator performed
 * the re-share.
 */
export async function grantFileAccess(data: {
  fileId: string;
  userId: string;
  encryptedPrivateHierarchicalKey: string;
  wrappedByPublicKey: string;
  permissionLevel?: PermissionLevel;
  isOwnerRow?: boolean;
}): Promise<void> {
  const { error } = await supabase.from("file_keys").upsert(
    {
      file_id: data.fileId,
      user_id: data.userId,
      encrypted_private_hierarchical_key: data.encryptedPrivateHierarchicalKey,
      wrapped_by_public_key: data.wrappedByPublicKey,
      // Owner's own row is labelled 'owner'; new grants default to 'editor'.
      permission_level: data.isOwnerRow ? "owner" : data.permissionLevel ?? "editor",
    },
    { onConflict: "file_id,user_id" }
  );
  if (error) throw new Error(`Failed to grant access: ${error.message}`);
}

/**
 * Revoke a collaborator's access by deleting their wrapped session key row.
 * Note: Phase 1 does NOT rotate the session key, so a collaborator who
 * cached content before revocation retains decrypt capability on that cache.
 * Forward-secret revocation is deferred to Phase 5.
 */
export async function revokeFileAccess(fileId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("file_keys")
    .delete()
    .eq("file_id", fileId)
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to revoke access: ${error.message}`);
}

export type PermissionLevel = "editor" | "viewer";

export interface CollaboratorRow {
  user_id: string;
  email: string;
  display_name: string | null;
  public_encryption_key: string;
  public_kem_key: string;
  is_owner: boolean;
  permission_level: PermissionLevel;
}

/**
 * List everyone who currently has a wrapped session key for a file. Owner
 * first, then collaborators by addition order. Done as two queries — the
 * PostgREST embedded-join shape for a belongs-to relationship is ambiguous
 * between single-object and single-element-array across client versions,
 * and collapsing it was hiding real email/pubkey data behind empty strings.
 */
export async function getCollaborators(fileId: string): Promise<CollaboratorRow[]> {
  const { data: rows, error } = await supabase
    .from("file_keys")
    .select("user_id, permission_level")
    .eq("file_id", fileId);
  if (error) throw new Error(`Failed to load collaborators: ${error.message}`);
  if (!rows || rows.length === 0) return [];

  const userIds = (rows as { user_id: string; permission_level: PermissionLevel }[]).map(
    (r) => r.user_id
  );
  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select("id, email, display_name, public_encryption_key, public_kem_key")
    .in("id", userIds);
  if (usersErr) throw new Error(`Failed to load users: ${usersErr.message}`);

  const { data: file } = await supabase
    .from("files")
    .select("owner_id")
    .eq("id", fileId)
    .single();
  const ownerId = (file as { owner_id: string } | null)?.owner_id ?? null;

  const userById = new Map(
    (users as { id: string; email: string; display_name: string | null; public_encryption_key: string; public_kem_key: string }[]).map((u) => [u.id, u])
  );

  return (rows as { user_id: string; permission_level: PermissionLevel }[])
    .map((r) => {
      const u = userById.get(r.user_id);
      return {
        user_id: r.user_id,
        email: u?.email ?? "",
        display_name: u?.display_name ?? null,
        public_encryption_key: u?.public_encryption_key ?? "",
        public_kem_key: u?.public_kem_key ?? "",
        is_owner: r.user_id === ownerId,
        permission_level: r.permission_level ?? "editor",
      };
    })
    .sort((a, b) => (a.is_owner === b.is_owner ? 0 : a.is_owner ? -1 : 1));
}

/**
 * Bulk version of `getCollaborators` — returns a Map keyed by file_id so
 * the file-list endpoint can enrich each row with an avatar stack without
 * doing N+1 queries.
 */
export async function getCollaboratorsBulk(
  fileIds: string[]
): Promise<Map<string, CollaboratorRow[]>> {
  const result = new Map<string, CollaboratorRow[]>();
  if (fileIds.length === 0) return result;

  const { data: fkRows, error: fkErr } = await supabase
    .from("file_keys")
    .select("file_id, user_id, permission_level")
    .in("file_id", fileIds);
  if (fkErr) throw new Error(`Failed to load file_keys: ${fkErr.message}`);
  if (!fkRows || fkRows.length === 0) return result;

  const userIds = Array.from(
    new Set((fkRows as { user_id: string }[]).map((r) => r.user_id))
  );
  const { data: users, error: usersErr } = await supabase
    .from("users")
    .select("id, email, display_name, public_encryption_key, public_kem_key")
    .in("id", userIds);
  if (usersErr) throw new Error(`Failed to load users: ${usersErr.message}`);

  const { data: files } = await supabase
    .from("files")
    .select("id, owner_id")
    .in("id", fileIds);
  const ownerByFile = new Map(
    (files as { id: string; owner_id: string }[] | null)?.map((f) => [f.id, f.owner_id]) ?? []
  );

  const userById = new Map(
    (users as { id: string; email: string; display_name: string | null; public_encryption_key: string; public_kem_key: string }[]).map((u) => [u.id, u])
  );

  for (const row of fkRows as {
    file_id: string;
    user_id: string;
    permission_level: PermissionLevel;
  }[]) {
    const u = userById.get(row.user_id);
    const ownerId = ownerByFile.get(row.file_id);
    const collab: CollaboratorRow = {
      user_id: row.user_id,
      email: u?.email ?? "",
      display_name: u?.display_name ?? null,
      public_encryption_key: u?.public_encryption_key ?? "",
      public_kem_key: u?.public_kem_key ?? "",
      is_owner: row.user_id === ownerId,
      permission_level: row.permission_level ?? "editor",
    };
    const list = result.get(row.file_id);
    if (list) list.push(collab);
    else result.set(row.file_id, [collab]);
  }

  // Sort: owner first, then by displayName-or-email for stable avatar ordering.
  for (const list of result.values()) {
    list.sort((a, b) => {
      if (a.is_owner !== b.is_owner) return a.is_owner ? -1 : 1;
      return (a.display_name || a.email).localeCompare(b.display_name || b.email);
    });
  }
  return result;
}

// ──────────────────────────────────────────────────────────────────────
// Phase 5.1 — folder rotation helpers
// ──────────────────────────────────────────────────────────────────────

export interface DirectChildNode {
  id: string;
  parent_id: string | null;
  is_folder: boolean;
  public_hierarchical_key: string;
  public_kem_hierarchical_key: string;
  parent_keys_claim: string | null;
  parent_keys_claim_wrapped_by: string | null;
  encrypted_session_key_by_file: string;
  session_key_nonce: string;
}

/**
 * Phase 5.1 folder shallow rotation — the commit endpoint needs to know
 * the *exact* current set of direct children so it can validate that the
 * client's rewrappedChildren payload matches (no omissions, no extras).
 * Intentionally does NOT recurse: shallow rotation only re-wraps
 * parent_keys_claim on the folder's immediate children; grandchildren
 * and deeper inherit through their own parent's unchanged pub hier key.
 */
export async function getDirectChildrenWithClaims(
  folderId: string
): Promise<DirectChildNode[]> {
  const { data, error } = await supabase
    .from("files")
    .select(
      "id, parent_id, is_folder, public_hierarchical_key, public_kem_hierarchical_key, parent_keys_claim, parent_keys_claim_wrapped_by, encrypted_session_key_by_file, session_key_nonce"
    )
    .eq("parent_id", folderId)
    .eq("upload_complete", true);
  if (error) throw new Error(`Failed to load direct children: ${error.message}`);
  return (data as DirectChildNode[] | null) ?? [];
}

/**
 * Update a collaborator's permission level. Owner-only. Does not affect
 * the wrapped session key or cryptographic access — Phase 1 Viewer/Editor
 * is enforced server-side via ACL on write endpoints.
 */
export async function setCollaboratorPermission(
  fileId: string,
  userId: string,
  level: PermissionLevel
): Promise<void> {
  const { error } = await supabase
    .from("file_keys")
    .update({ permission_level: level })
    .eq("file_id", fileId)
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to update permission: ${error.message}`);
}

// ──────────────────────────────────────────────────────────────────────
// Phase 6 — trash (soft delete)
// ──────────────────────────────────────────────────────────────────────

/**
 * Personal-drive soft delete. Scopes the recursive CTE to files the
 * caller owns — so a user can only trash rows they own, even when
 * operating on a subtree. Fine for personal drive where every file
 * under a folder is owned by the folder owner.
 *
 * For WORKSPACE files (mixed-owner subtrees), use
 * `trashSubtreeUnscoped` — the caller's permission is checked at
 * the route layer and the RPC just flips the whole subtree.
 */
export async function trashSubtree(fileId: string, ownerId: string): Promise<void> {
  const { error } = await supabase.rpc("soft_delete_subtree", {
    p_root: fileId,
    p_owner: ownerId,
  });
  if (error) throw new Error(`Failed to trash: ${error.message}`);
}

/**
 * Workspace soft delete — trashes the entire subtree regardless of
 * per-row owner. Caller MUST have already verified permission at the
 * route layer (`getEffectivePermission` for the root).
 */
export async function trashSubtreeUnscoped(fileId: string): Promise<void> {
  const { error } = await supabase.rpc("soft_delete_subtree_unscoped", {
    p_root: fileId,
  });
  if (error) throw new Error(`Failed to trash: ${error.message}`);
}

export async function restoreSubtree(fileId: string, ownerId: string): Promise<void> {
  const { error } = await supabase.rpc("restore_subtree", {
    p_root: fileId,
    p_owner: ownerId,
  });
  if (error) throw new Error(`Failed to restore: ${error.message}`);
}

export async function restoreSubtreeUnscoped(fileId: string): Promise<void> {
  const { error } = await supabase.rpc("restore_subtree_unscoped", {
    p_root: fileId,
  });
  if (error) throw new Error(`Failed to restore: ${error.message}`);
}

/**
 * List trashed items at the "top level" of trash — i.e. rows whose
 * parent is either not deleted or has a different `deleted_at` than
 * this row. That way a trashed folder surfaces once, and its
 * recursively-trashed children stay hidden behind it.
 *
 * Returned shape matches `getFilesForUser` so the same client-side
 * decrypt loop can render it without branching.
 */
export async function getTrashedForUser(userId: string, workspaceId?: string | null): Promise<FileRowWithKey[]> {
  // In workspace context, show all trashed files in the workspace
  // regardless of owner. In personal context, show only owned files.
  let query = supabase
    .from("files")
    .select(LIST_SELECT)
    .eq("upload_complete", true)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });

  if (workspaceId) {
    // Workspace trash: show all trashed files regardless of owner.
    // Use a left-join select since the caller may not have direct file_keys rows.
    const { data: wsTrashed, error: wsErr } = await supabase
      .from("files")
      .select("*, owner:users!files_owner_id_fkey(public_encryption_key, public_kem_key)")
      .eq("workspace_id", workspaceId)
      .eq("upload_complete", true)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (wsErr) throw new Error(`Failed to fetch trashed: ${wsErr.message}`);

    const rows = (wsTrashed || []) as unknown as (FileJoinRow & { id: string; parent_id: string | null; deleted_at: string })[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const tops = rows.filter((r) => {
      if (!r.parent_id) return true;
      const parent = byId.get(r.parent_id);
      if (!parent) return true;
      return parent.deleted_at !== r.deleted_at;
    });

    // Fetch file_keys for these files so callers that have direct rows can decrypt
    const topIds = tops.map((r) => r.id);
    const { data: keyRows } = topIds.length > 0
      ? await supabase.from("file_keys").select("file_id, encrypted_private_hierarchical_key, wrapped_by_public_key").eq("user_id", userId).in("file_id", topIds)
      : { data: [] };
    const keyMap = new Map((keyRows || []).map((k) => [k.file_id as string, k]));

    return tops.map((row) => {
      const key = keyMap.get(row.id);
      const { owner, ...rest } = row as unknown as Record<string, unknown> & { owner: { public_encryption_key: string } | null };
      return {
        ...rest,
        encrypted_private_hierarchical_key: (key?.encrypted_private_hierarchical_key as string) ?? "",
        wrapped_by_public_key: (key?.wrapped_by_public_key as string) ?? "",
        owner_public_key: owner?.public_encryption_key ?? "",
      } as FileRowWithKey;
    });
  }

  query = query.eq("owner_id", userId).is("workspace_id", null).eq("is_workspace_root", false);

  const { data: allTrashed, error } = await query;
  if (error) throw new Error(`Failed to fetch trashed: ${error.message}`);

  const rows = (allTrashed || []) as unknown as (FileJoinRow & {
    id: string;
    parent_id: string | null;
    deleted_at: string;
  })[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  // A row is a "top-level trash entry" when its parent isn't trashed
  // (or has a different deleted_at — meaning the parent was trashed
  // separately at a different time and they should surface as peers).
  const tops = rows.filter((r) => {
    if (!r.parent_id) return true;
    const parent = byId.get(r.parent_id);
    if (!parent) return true; // parent isn't in this user's trash
    return parent.deleted_at !== r.deleted_at;
  });

  return tops.map((row) => shapeRow(row as unknown as FileJoinRow));
}

/**
 * Most recently touched files across all folders — flat list, capped
 * at 50. "Recent" means updated_at desc; the column is bumped on
 * upload finalize, rename, and move so it's a reasonable proxy for
 * "last interacted with".
 */
export async function getRecentForUser(userId: string): Promise<FileRowWithKey[]> {
  // Reuses getAllAccessibleFiles so inherited descendants (files a
  // collaborator created inside a folder the user shared) show up
  // too, not just files with a direct file_keys row for the caller.
  // Sorted + sliced client-side; drive sizes we serve are small
  // enough that the full fetch is cheap.
  const all = await getAllAccessibleFiles(userId, { includeWorkspaces: false });
  return all
    .slice()
    .sort((a, b) => {
      const au = a.updated_at ?? "";
      const bu = b.updated_at ?? "";
      return bu.localeCompare(au);
    })
    .slice(0, 50);
}

/**
 * All files the user can access — owned + shared, flat, no folder
 * scoping. Used to build the client-side search index. Capped at
 * 500 rows to keep the response reasonable.
 */
export async function getAllAccessibleFiles(
  userId: string,
  options: { includeWorkspaces?: boolean } = {},
): Promise<FileRowWithKey[]> {
  const { includeWorkspaces = false } = options;

  // Owned files. By default we exclude workspace files because the
  // primary caller (export-as-zip) only handles personal drive. Search
  // passes includeWorkspaces=true so its cache covers the user's full
  // accessible set.
  let ownedQuery = supabase
    .from("files")
    .select(LIST_SELECT)
    .eq("owner_id", userId)
    .eq("file_keys.user_id", userId)
    .eq("upload_complete", true)
    .eq("is_workspace_root", false)
    .is("deleted_at", null);
  if (!includeWorkspaces) ownedQuery = ownedQuery.is("workspace_id", null);
  const { data: owned, error: ownErr } = await ownedQuery.limit(500);
  if (ownErr) throw new Error(`Failed to fetch owned files: ${ownErr.message}`);

  // Shared files (where user has a direct file_keys row but isn't
  // owner). Same workspace inclusion logic as above.
  let sharedQuery = supabase
    .from("files")
    .select(LIST_SELECT)
    .eq("file_keys.user_id", userId)
    .neq("owner_id", userId)
    .eq("upload_complete", true)
    .eq("is_workspace_root", false)
    .is("deleted_at", null);
  if (!includeWorkspaces) sharedQuery = sharedQuery.is("workspace_id", null);
  const { data: shared, error: sharedErr } = await sharedQuery.limit(200);
  if (sharedErr) throw new Error(`Failed to fetch shared files: ${sharedErr.message}`);

  const ownedRows = (owned || []).map((r) => shapeRow(r as unknown as FileJoinRow));
  const sharedRows = (shared || []).map((r) => shapeRow(r as unknown as FileJoinRow));
  let combined = [...ownedRows, ...sharedRows];

  // Inherited workspace files: files in a workspace the user is a
  // member of, where they have NO direct file_keys row (i.e. they're
  // not the creator and weren't individually shared on). They access
  // these via the parent_keys_claim chain rooted at the workspace
  // root, which they DO have a file_keys row for. The client builds
  // the chain itself; we just need to surface the file rows.
  if (includeWorkspaces) {
    const { data: memberships } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId);
    const wsIds = (memberships ?? []).map((m) => m.workspace_id as string);
    if (wsIds.length > 0) {
      const knownIds = new Set(combined.map((f) => f.id));
      // Same LIST_SELECT but the file_keys join becomes a left join via
      // PostgREST embedding — without an .eq filter on file_keys.user_id
      // we get rows whether or not the user has a key. We then exclude
      // rows we already have via the owned/shared queries.
      // Include workspace ROOT rows too — the client needs them to
      // seed the inheritance chain (without the root's priv hier key,
      // descendants in shared subtrees can't be decrypted). Search
      // filters out workspace roots from results downstream so they
      // don't appear as user-visible "files" in the palette.
      const { data: wsFiles, error: wsErr } = await supabase
        .from("files")
        .select(LIST_SELECT)
        .in("workspace_id", wsIds)
        .eq("upload_complete", true)
        .is("deleted_at", null)
        .limit(1000);
      if (wsErr) throw new Error(`Failed to fetch workspace files: ${wsErr.message}`);
      const inheritedRows = (wsFiles ?? [])
        .map((r) => shapeRow(r as unknown as FileJoinRow))
        .filter((f) => !knownIds.has(f.id));
      combined = [...combined, ...inheritedRows];
    }
  }

  // Inherited personal-drive descendants: files whose parent is in
  // the accessible set but the caller has no direct file_keys row on
  // the child. Common case — a collaborator the caller shared a
  // folder with creates a new subfolder or uploads a file inside it.
  // That child's `owner_id` is the collaborator, its file_keys row
  // is for the collaborator, and the caller's access is purely via
  // the `parent_keys_claim` chain. The owned/shared queries miss it
  // because they require a direct file_keys row.
  //
  // Uses a left-join pattern (fetch files, then fetch *the caller's*
  // file_keys rows separately and merge) so rows without a caller
  // key return with empty key fields. The client then falls through
  // to the parent_keys_claim branch instead of trying to unwrap a
  // stranger's wrapped key and failing. Mirrors getInheritedChildren.
  //
  // We walk down the parent tree iteratively until no new rows
  // appear; depth cap protects against loops (not reachable today
  // but cheap insurance).
  const accessibleIds = new Set(combined.map((f) => f.id));
  let frontier = Array.from(accessibleIds);
  let depth = 0;
  while (frontier.length > 0 && depth < 32) {
    depth++;
    const { data: children, error: cErr } = await supabase
      .from("files")
      .select("*, owner:users!files_owner_id_fkey(public_encryption_key, public_kem_key)")
      .in("parent_id", frontier)
      .eq("upload_complete", true)
      .is("deleted_at", null)
      .limit(1000);
    if (cErr) throw new Error(`Failed to fetch inherited children: ${cErr.message}`);
    const rawRows = (children ?? []) as unknown as (FileRow & {
      owner: { public_encryption_key: string; public_kem_key: string } | null;
    })[];
    const newIds: string[] = [];
    for (const raw of rawRows) {
      if (!accessibleIds.has(raw.id)) newIds.push(raw.id);
    }
    if (newIds.length === 0) break;
    const { data: keyRows } = await supabase
      .from("file_keys")
      .select("file_id, encrypted_private_hierarchical_key, wrapped_by_public_key")
      .eq("user_id", userId)
      .in("file_id", newIds);
    const keyByFile = new Map(
      (keyRows ?? []).map((k) => [
        k.file_id as string,
        {
          encrypted_private_hierarchical_key: k.encrypted_private_hierarchical_key as string,
          wrapped_by_public_key: k.wrapped_by_public_key as string,
        },
      ]),
    );
    const nextFrontier: string[] = [];
    for (const raw of rawRows) {
      if (accessibleIds.has(raw.id)) continue;
      accessibleIds.add(raw.id);
      const fk = keyByFile.get(raw.id);
      const { owner, ...rest } = raw as unknown as Record<string, unknown> & {
        owner: { public_encryption_key: string; public_kem_key: string } | null;
      };
      const shaped: FileRowWithKey = {
        ...(rest as unknown as FileRow),
        encrypted_private_hierarchical_key: fk?.encrypted_private_hierarchical_key ?? "",
        wrapped_by_public_key: fk?.wrapped_by_public_key ?? "",
        owner_public_key: owner?.public_encryption_key ?? "",
        owner_public_kem_key: owner?.public_kem_key ?? "",
      };
      combined.push(shaped);
      if (shaped.is_folder) nextFrontier.push(shaped.id);
    }
    frontier = nextFrontier;
  }

  return combined;
}

/**
 * Toggle star for ANY user on ANY file they can access. Per-user
 * stars live in the `user_stars` junction table, so one user's
 * star never affects another's.
 */
export async function toggleStar(fileId: string, userId: string, starred: boolean): Promise<void> {
  if (starred) {
    const { error } = await supabase
      .from("user_stars")
      .upsert({ user_id: userId, file_id: fileId }, { onConflict: "user_id,file_id" });
    if (error) throw new Error(`Failed to star: ${error.message}`);
  } else {
    const { error } = await supabase
      .from("user_stars")
      .delete()
      .eq("user_id", userId)
      .eq("file_id", fileId);
    if (error) throw new Error(`Failed to unstar: ${error.message}`);
  }
}

/**
 * List starred files for a user. Per-user — each user has their own
 * starred set independent of the file owner.
 */
export async function getStarredForUser(userId: string): Promise<FileRowWithKey[]> {
  const { data: stars, error: starErr } = await supabase
    .from("user_stars")
    .select("file_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (starErr) throw new Error(`Failed to fetch stars: ${starErr.message}`);
  if (!stars || stars.length === 0) return [];

  // Intersect the star set with the full accessibility set so
  // inherited files (ones the user starred but doesn't have a direct
  // file_keys row on) still appear here, instead of silently
  // dropping. Preserves the original star-time sort order.
  const starOrder = new Map<string, number>();
  stars.forEach((s, i) => starOrder.set(s.file_id as string, i));
  const all = await getAllAccessibleFiles(userId, { includeWorkspaces: false });
  return all
    .filter((f) => starOrder.has(f.id))
    .sort((a, b) => (starOrder.get(a.id)! - starOrder.get(b.id)!));
}

/**
 * Get a file for download/preview, supporting both direct file_keys
 * access AND inherited access via the parent_keys_claim chain.
 * Returns the file row plus the full parent chain data the client
 * needs to walk. Falls back through parents until a direct
 * file_keys row is found for this user.
 */
export async function getFileForDownload(
  fileId: string,
  userId: string
): Promise<{
  file: FileRow & { owner_public_key: string; owner_public_kem_key: string };
  directKey: { encrypted_private_hierarchical_key: string; wrapped_by_public_key: string } | null;
  parentChain: {
    fileId: string;
    parentKeysClaim: string;
    parentKeysClaimWrappedBy: string;
    publicHierarchicalKey: string;
    publicKemHierarchicalKey: string;
  }[];
  ancestorKey: { encrypted_private_hierarchical_key: string; wrapped_by_public_key: string; owner_public_key: string; owner_public_kem_key: string } | null;
} | null> {
  // 1. Fetch the file itself
  const { data: fileRow, error: fileErr } = await supabase
    .from("files")
    .select("*, owner:users!files_owner_id_fkey(public_encryption_key, public_kem_key)")
    .eq("id", fileId)
    .eq("upload_complete", true)
    .is("deleted_at", null)
    .single();
  if (fileErr || !fileRow) return null;

  const ownerRow = fileRow.owner as { public_encryption_key: string; public_kem_key: string } | null;
  const ownerPub = ownerRow?.public_encryption_key || "";
  const ownerKemPub = ownerRow?.public_kem_key || "";
  const { owner: _o, ...fileData } = fileRow;
  const file = {
    ...fileData,
    owner_public_key: ownerPub,
    owner_public_kem_key: ownerKemPub,
  } as FileRow & { owner_public_key: string; owner_public_kem_key: string };

  // 2. Check for direct file_keys row
  const { data: directFk } = await supabase
    .from("file_keys")
    .select("encrypted_private_hierarchical_key, wrapped_by_public_key")
    .eq("file_id", fileId)
    .eq("user_id", userId)
    .single();

  if (directFk) {
    return { file, directKey: directFk, parentChain: [], ancestorKey: null };
  }

  // 3. Walk up the parent chain collecting parent_keys_claim entries
  //    until we find a folder the user has a direct file_keys row on.
  const chain: {
    fileId: string;
    parentKeysClaim: string;
    parentKeysClaimWrappedBy: string;
    publicHierarchicalKey: string;
    publicKemHierarchicalKey: string;
  }[] = [];

  let current = file;
  const MAX_DEPTH = 64;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (!current.parent_id || !current.parent_keys_claim || !current.parent_keys_claim_wrapped_by) {
      return null; // no access path
    }

    chain.push({
      fileId: current.id,
      parentKeysClaim: current.parent_keys_claim,
      parentKeysClaimWrappedBy: current.parent_keys_claim_wrapped_by,
      publicHierarchicalKey: current.public_hierarchical_key,
      publicKemHierarchicalKey: current.public_kem_hierarchical_key,
    });

    // Check if user has a key on the parent
    const { data: parentFk } = await supabase
      .from("file_keys")
      .select("encrypted_private_hierarchical_key, wrapped_by_public_key")
      .eq("file_id", current.parent_id)
      .eq("user_id", userId)
      .single();

    if (parentFk) {
      // Also get the parent file's owner pub key and pub hier key
      const { data: parentFile } = await supabase
        .from("files")
        .select("public_hierarchical_key, encrypted_session_key_by_file, session_key_nonce, owner:users!files_owner_id_fkey(public_encryption_key, public_kem_key)")
        .eq("id", current.parent_id)
        .single();
      const parentOwnerRow = (parentFile?.owner as unknown) as { public_encryption_key: string; public_kem_key: string } | null;
      return {
        file,
        directKey: null,
        parentChain: chain,
        ancestorKey: {
          encrypted_private_hierarchical_key: parentFk.encrypted_private_hierarchical_key,
          wrapped_by_public_key: parentFk.wrapped_by_public_key,
          owner_public_key: parentOwnerRow?.public_encryption_key || "",
          owner_public_kem_key: parentOwnerRow?.public_kem_key || "",
        },
      };
    }

    // Move up to the parent — must also be live (not trashed)
    const { data: parentRow } = await supabase
      .from("files")
      .select("*, owner:users!files_owner_id_fkey(public_encryption_key, public_kem_key)")
      .eq("id", current.parent_id)
      .is("deleted_at", null)
      .single();
    if (!parentRow) return null;
    const pOwnerRow = parentRow.owner as { public_encryption_key: string; public_kem_key: string } | null;
    const { owner: _po, ...pData } = parentRow;
    current = {
      ...pData,
      owner_public_key: pOwnerRow?.public_encryption_key || "",
      owner_public_kem_key: pOwnerRow?.public_kem_key || "",
    } as FileRow & { owner_public_key: string; owner_public_kem_key: string };
  }

  return null; // depth limit
}

/**
 * Get the caller's permission level on a file. Returns "owner",
 * "editor", "viewer", or null (no access). Checks the direct
 * file_keys row only — inherited access isn't modeled here because
 * inherited children share the parent's permission level.
 */
export async function getUserPermission(
  fileId: string,
  userId: string
): Promise<"owner" | PermissionLevel | null> {
  const { data, error } = await supabase
    .from("file_keys")
    .select("permission_level")
    .eq("file_id", fileId)
    .eq("user_id", userId)
    .single();
  if (error || !data) return null;
  return (data.permission_level as "owner" | PermissionLevel) ?? "editor";
}

/**
 * Get the caller's effective permission on a file, walking up the
 * parent chain if no direct file_keys row exists (inherited access).
 */
export async function getEffectivePermission(
  fileId: string,
  userId: string
): Promise<"owner" | PermissionLevel | null> {
  // Direct check first
  const direct = await getUserPermission(fileId, userId);
  if (direct) return direct;

  // Walk up parents
  let currentId: string | null = fileId;
  const MAX_DEPTH = 64;
  for (let depth = 0; depth < MAX_DEPTH && currentId; depth++) {
    const { data } = await supabase
      .from("files")
      .select("parent_id")
      .eq("id", currentId)
      .single();
    if (!data?.parent_id) return null;
    const parentPerm = await getUserPermission(data.parent_id as string, userId);
    if (parentPerm) return parentPerm;
    currentId = data.parent_id as string;
  }
  return null;
}

/**
 * Move: change a file's `parent_id` and re-wrap its
 * `parent_keys_claim`. Owner-only; the route handler validates the
 * caller owns both the file being moved and the destination folder
 * (or the destination is null = root), plus the cycle check.
 *
 * When moving to root (`newParentId = null`), `parentKeysClaim` and
 * `parentKeysClaimWrappedBy` MUST both be null — there's no parent
 * whose pub hier key to wrap under. The route enforces this
 * coupling; we trust it here.
 */
export async function moveFile(
  fileId: string,
  newParentId: string | null,
  parentKeysClaim: string | null,
  parentKeysClaimWrappedBy: string | null,
  workspaceId?: string | null
): Promise<void> {
  const updates: Record<string, unknown> = {
    parent_id: newParentId,
    parent_keys_claim: parentKeysClaim,
    parent_keys_claim_wrapped_by: parentKeysClaimWrappedBy,
  };
  if (workspaceId !== undefined) updates.workspace_id = workspaceId;
  const { error } = await supabase
    .from("files")
    .update(updates)
    .eq("id", fileId);
  if (error) throw new Error(`Failed to move file: ${error.message}`);
}

/**
 * Rename: overwrite the `encrypted_metadata` blob. Server never sees
 * plaintext — the caller has already re-encrypted under the file's
 * session key. The access gate is the caller's `file_keys` row (any
 * collaborator may rename, matching Skiff/Proton semantics); the
 * route handler checks this via `getFileById` before calling us.
 */
export async function updateFileMetadata(
  fileId: string,
  encryptedMetadata: string
): Promise<void> {
  const { error } = await supabase
    .from("files")
    .update({ encrypted_metadata: encryptedMetadata })
    .eq("id", fileId);
  if (error) throw new Error(`Failed to update metadata: ${error.message}`);
}

export async function deleteFile(fileId: string, ownerId: string): Promise<string | null> {
  // Get storage key before deleting
  const { data: file } = await supabase
    .from("files")
    .select("storage_key")
    .eq("id", fileId)
    .eq("owner_id", ownerId)
    .single();

  const { error } = await supabase
    .from("files")
    .delete()
    .eq("id", fileId)
    .eq("owner_id", ownerId);

  if (error) throw new Error(`Failed to delete file: ${error.message}`);

  return file?.storage_key || null;
}

export async function createFolder(data: {
  ownerId: string;
  parentId: string | null;
  encryptedMetadata: string;
  publicHierarchicalKey: string;
  publicKemHierarchicalKey: string;
  encryptedSessionKeyByFile: string;
  sessionKeyNonce: string;
  parentKeysClaim?: string | null;
  parentKeysClaimWrappedBy?: string | null;
}): Promise<FileRow> {
  return createFile({
    ownerId: data.ownerId,
    parentId: data.parentId,
    encryptedMetadata: data.encryptedMetadata,
    isFolder: true,
    sizeBytes: 0,
    storageKey: null,
    publicHierarchicalKey: data.publicHierarchicalKey,
    publicKemHierarchicalKey: data.publicKemHierarchicalKey,
    encryptedSessionKeyByFile: data.encryptedSessionKeyByFile,
    sessionKeyNonce: data.sessionKeyNonce,
    parentKeysClaim: data.parentKeysClaim ?? null,
    parentKeysClaimWrappedBy: data.parentKeysClaimWrappedBy ?? null,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Phase 4 — file_links
// ──────────────────────────────────────────────────────────────────────

export interface FileLinkRow {
  id: string;
  file_id: string;
  created_by: string;
  encrypted_private_hierarchical_key: string;
  link_key_nonce: string;
  permission_level: "viewer";
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  // Phase 4.1 — password wrap. All three are present together (CHECK)
  // or all NULL (regular link).
  password_salt: string | null;
  password_wrapped_link_key: string | null;
  password_wrap_nonce: string | null;
}

/**
 * Shape returned by `getLinkById` for the anonymous /api/files/link/[id]
 * route. Embeds only the file fields the visitor needs to perform the
 * two-step client-side unwrap; no file_keys rows are included because
 * the visitor uses the link's own secretbox wrap instead.
 */
export interface AnonymousLinkPayload {
  link: FileLinkRow;
  file: {
    id: string;
    owner_id: string;
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
    owner_public_key: string;
    owner_display_name: string | null;
  };
}

export async function createLink(data: {
  fileId: string;
  createdBy: string;
  encryptedPrivateHierarchicalKey: string;
  linkKeyNonce: string;
  expiresAt?: string | null;
  passwordSalt?: string | null;
  passwordWrappedLinkKey?: string | null;
  passwordWrapNonce?: string | null;
}): Promise<{ id: string }> {
  const { data: row, error } = await supabase
    .from("file_links")
    .insert({
      file_id: data.fileId,
      created_by: data.createdBy,
      encrypted_private_hierarchical_key: data.encryptedPrivateHierarchicalKey,
      link_key_nonce: data.linkKeyNonce,
      expires_at: data.expiresAt ?? null,
      password_salt: data.passwordSalt ?? null,
      password_wrapped_link_key: data.passwordWrappedLinkKey ?? null,
      password_wrap_nonce: data.passwordWrapNonce ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create link: ${error.message}`);
  return { id: (row as { id: string }).id };
}

/**
 * Anonymous-safe link lookup. Returns null for "not found OR revoked OR
 * expired" so every failure collapses to a single 404 — no distinguishing
 * between "never existed" and "revoked" from outside.
 */
export async function getLinkById(linkId: string): Promise<AnonymousLinkPayload | null> {
  const { data, error } = await supabase
    .from("file_links")
    .select("*")
    .eq("id", linkId)
    .is("revoked_at", null)
    .single();
  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch link: ${error.message}`);
  }
  if (!data) return null;
  const link = data as FileLinkRow;
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) return null;

  const { data: file, error: fileErr } = await supabase
    .from("files")
    .select(
      "id, owner_id, parent_id, encrypted_metadata, is_folder, size_bytes, storage_key, encryption_nonce, chunk_count, public_hierarchical_key, public_kem_hierarchical_key, encrypted_session_key_by_file, session_key_nonce, owner:users!files_owner_id_fkey(public_encryption_key, public_kem_key, display_name)"
    )
    .eq("id", link.file_id)
    .eq("upload_complete", true)
    .single();
  if (fileErr || !file) return null;

  const fileRow = file as unknown as {
    id: string;
    owner_id: string;
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
    owner: { public_encryption_key: string; display_name: string | null } | null;
  };

  return {
    link,
    file: {
      id: fileRow.id,
      owner_id: fileRow.owner_id,
      parent_id: fileRow.parent_id,
      encrypted_metadata: fileRow.encrypted_metadata,
      is_folder: fileRow.is_folder,
      size_bytes: fileRow.size_bytes,
      storage_key: fileRow.storage_key,
      encryption_nonce: fileRow.encryption_nonce,
      chunk_count: fileRow.chunk_count,
      public_hierarchical_key: fileRow.public_hierarchical_key,
      encrypted_session_key_by_file: fileRow.encrypted_session_key_by_file,
      session_key_nonce: fileRow.session_key_nonce,
      owner_public_key: fileRow.owner?.public_encryption_key ?? "",
      owner_display_name: fileRow.owner?.display_name ?? null,
    },
  };
}

/**
 * Active (non-revoked, non-expired) links for a file. Caller must verify
 * access to the file upstream — this helper performs no ACL check.
 */
export async function getLinksForFile(fileId: string): Promise<FileLinkRow[]> {
  const { data, error } = await supabase
    .from("file_links")
    .select("*")
    .eq("file_id", fileId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to list links: ${error.message}`);
  const now = Date.now();
  return ((data as FileLinkRow[]) ?? []).filter(
    (r) => !r.expires_at || new Date(r.expires_at).getTime() > now
  );
}

/**
 * Revoke a link. Allowed by either the link creator or the current file
 * owner. Returns true on successful revoke, false if the caller isn't
 * authorised or the link doesn't exist.
 */
export async function revokeLink(linkId: string, actingUserId: string): Promise<boolean> {
  const { data: link, error } = await supabase
    .from("file_links")
    .select("file_id, created_by, revoked_at")
    .eq("id", linkId)
    .single();
  if (error || !link) return false;
  const linkRow = link as { file_id: string; created_by: string; revoked_at: string | null };
  if (linkRow.revoked_at) return true; // already revoked is idempotent

  let authorised = linkRow.created_by === actingUserId;
  if (!authorised) {
    const { data: file } = await supabase
      .from("files")
      .select("owner_id")
      .eq("id", linkRow.file_id)
      .single();
    authorised = (file as { owner_id: string } | null)?.owner_id === actingUserId;
  }
  if (!authorised) return false;

  const { error: updateErr } = await supabase
    .from("file_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId);
  if (updateErr) throw new Error(`Failed to revoke link: ${updateErr.message}`);
  return true;
}

/**
 * Walks upward from `candidateId` through `parent_id` links and returns
 * true if `ancestorFileId` appears in the chain (or equals the candidate).
 * Bounded to 64 levels as defence-in-depth against pathological cycles.
 */
export async function isDescendantOf(
  ancestorFileId: string,
  candidateId: string
): Promise<boolean> {
  if (ancestorFileId === candidateId) return true;
  let current: string | null = candidateId;
  const MAX_DEPTH = 64;
  for (let depth = 0; depth < MAX_DEPTH && current; depth++) {
    const query: { data: unknown; error: unknown } = await supabase
      .from("files")
      .select("parent_id")
      .eq("id", current)
      .single();
    if (query.error || !query.data) return false;
    const nextParent = (query.data as { parent_id: string | null }).parent_id;
    if (nextParent === ancestorFileId) return true;
    current = nextParent;
  }
  // Hit the depth cap without resolving the walk. The create flow can't
  // introduce a cycle (parent_id is set once at creation and the
  // filesystem is a DAG by construction), but if one ever exists — via
  // admin intervention or a future bug — silently returning false would
  // hide a real data-corruption bug while still failing safely (the
  // caller's ACL check would deny access). Throw instead so operators
  // see the problem.
  throw new Error(
    `isDescendantOf hit depth cap of ${MAX_DEPTH} walking ${candidateId} → ${ancestorFileId}; possible parent_id cycle or pathological nesting`
  );
}
