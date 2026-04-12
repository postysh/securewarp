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
  encrypted_session_key_by_file: string;
  session_key_nonce: string;
  // Phase 3 — folder inheritance. When this file has a parent, the
  // claim wraps {sessionKey, childPrivateHierarchicalKey} under the
  // parent's public hierarchical key. Anyone holding the parent's
  // private hier key can unwrap descendants transitively. NULL for
  // root items.
  parent_keys_claim: string | null;
  parent_keys_claim_wrapped_by: string | null;
  created_at: string;
  updated_at: string;
}

// Shape returned by list/get endpoints. `encrypted_private_hierarchical_key`
// is the caller's per-user wrap (from their file_keys row); the session key
// is decrypted by first unwrapping the hierarchical private key, then using
// it to unwrap `encrypted_session_key_by_file` via box(owner.pub, file.priv).
export type FileRowWithKey = FileRow & {
  encrypted_private_hierarchical_key: string;
  // Who wrapped the caller's private-hier-key row. Usually the file owner;
  // for non-owner re-shares this is the sharer at the time of the grant.
  wrapped_by_public_key: string;
  // Owner's current public key, needed for the session-key unwrap step
  // (session_key is always wrapped by the owner at upload time).
  owner_public_key: string;
};

export interface FileKeyRow {
  file_id: string;
  user_id: string;
  encrypted_private_hierarchical_key: string;
  wrapped_by_public_key: string;
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
      encrypted_session_key_by_file: data.encryptedSessionKeyByFile,
      session_key_nonce: data.sessionKeyNonce,
      parent_keys_claim: data.parentKeysClaim ?? null,
      parent_keys_claim_wrapped_by: data.parentKeysClaimWrappedBy ?? null,
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
  owner: { public_encryption_key: string } | null;
};

function shapeRow(row: FileJoinRow): FileRowWithKey {
  const { file_keys, owner, ...rest } = row;
  const fk = file_keys[0];
  return {
    ...(rest as unknown as FileRow),
    encrypted_private_hierarchical_key: fk?.encrypted_private_hierarchical_key || "",
    wrapped_by_public_key: fk?.wrapped_by_public_key || "",
    owner_public_key: owner?.public_encryption_key || "",
  };
}

const LIST_SELECT =
  "*, file_keys!inner(encrypted_private_hierarchical_key, wrapped_by_public_key)," +
  " owner:users!files_owner_id_fkey(public_encryption_key)";

export async function getFilesForUser(
  userId: string,
  parentId: string | null
): Promise<FileRowWithKey[]> {
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
    query = query.is("parent_id", null);
  }

  const { data, error } = await query
    .order("is_folder", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch files: ${error.message}`);
  return (data || []).map((row) => shapeRow(row as unknown as FileJoinRow));
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
    .order("created_at", { ascending: false });

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
  // 1. Access check — is the parent accessible to the caller?
  const parent = await getFileById(parentId, userId);
  if (!parent) return [];

  // 2. All direct children, no file_keys filter (children of an inherited
  //    folder commonly have no direct row for this user).
  const { data: files, error } = await supabase
    .from("files")
    .select("*, owner:users!files_owner_id_fkey(public_encryption_key)")
    .eq("parent_id", parentId)
    .eq("upload_complete", true)
    .is("deleted_at", null)
    .order("is_folder", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to fetch children: ${error.message}`);
  if (!files || files.length === 0) return [];

  // 3. Any file_keys rows the caller does hold directly on these children.
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

  return (files as (FileRow & { owner: { public_encryption_key: string } | null })[]).map(
    (f) => {
      const direct = keyByFile.get(f.id);
      const { owner, ...rest } = f;
      return {
        ...rest,
        encrypted_private_hierarchical_key: direct?.encrypted_private_hierarchical_key ?? "",
        wrapped_by_public_key: direct?.wrapped_by_public_key ?? "",
        owner_public_key: owner?.public_encryption_key ?? "",
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
  public_encryption_key: string;
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
    .select("id, email, public_encryption_key")
    .in("id", userIds);
  if (usersErr) throw new Error(`Failed to load users: ${usersErr.message}`);

  const { data: file } = await supabase
    .from("files")
    .select("owner_id")
    .eq("id", fileId)
    .single();
  const ownerId = (file as { owner_id: string } | null)?.owner_id ?? null;

  const userById = new Map(
    (users as { id: string; email: string; public_encryption_key: string }[]).map((u) => [u.id, u])
  );

  return (rows as { user_id: string; permission_level: PermissionLevel }[])
    .map((r) => {
      const u = userById.get(r.user_id);
      return {
        user_id: r.user_id,
        email: u?.email ?? "",
        public_encryption_key: u?.public_encryption_key ?? "",
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
    .select("id, email, public_encryption_key")
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
    (users as { id: string; email: string; public_encryption_key: string }[]).map((u) => [u.id, u])
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
      public_encryption_key: u?.public_encryption_key ?? "",
      is_owner: row.user_id === ownerId,
      permission_level: row.permission_level ?? "editor",
    };
    const list = result.get(row.file_id);
    if (list) list.push(collab);
    else result.set(row.file_id, [collab]);
  }

  // Sort: owner first, then by email for stable avatar ordering.
  for (const list of result.values()) {
    list.sort((a, b) => {
      if (a.is_owner !== b.is_owner) return a.is_owner ? -1 : 1;
      return a.email.localeCompare(b.email);
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
      "id, parent_id, is_folder, public_hierarchical_key, parent_keys_claim, parent_keys_claim_wrapped_by, encrypted_session_key_by_file, session_key_nonce"
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
 * Owner-only soft delete. Calls the `soft_delete_subtree` recursive
 * CTE so trashing a folder marks every descendant in one statement.
 * Returns the number of rows touched (0 means the file wasn't found
 * or wasn't owned by the caller — the route handler treats this as
 * 404 to match the "don't reveal existence" convention).
 */
export async function trashSubtree(fileId: string, ownerId: string): Promise<void> {
  const { error } = await supabase.rpc("soft_delete_subtree", {
    p_root: fileId,
    p_owner: ownerId,
  });
  if (error) throw new Error(`Failed to trash: ${error.message}`);
}

/**
 * Owner-only restore. Uses the matching `restore_subtree` CTE which
 * only reverses rows whose `deleted_at` matches the root's — so a
 * file the user individually trashed earlier stays trashed when
 * their parent folder is restored later.
 */
export async function restoreSubtree(fileId: string, ownerId: string): Promise<void> {
  const { error } = await supabase.rpc("restore_subtree", {
    p_root: fileId,
    p_owner: ownerId,
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
export async function getTrashedForUser(userId: string): Promise<FileRowWithKey[]> {
  // Pull every trashed row the user owns. Grouping by the roots is
  // cheap at this point because trash sizes are small in practice;
  // if that ever changes we can move this into a SQL function.
  const { data: allTrashed, error } = await supabase
    .from("files")
    .select(LIST_SELECT)
    .eq("owner_id", userId)
    .eq("file_keys.user_id", userId)
    .eq("upload_complete", true)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
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
      "id, owner_id, parent_id, encrypted_metadata, is_folder, size_bytes, storage_key, encryption_nonce, chunk_count, public_hierarchical_key, encrypted_session_key_by_file, session_key_nonce, owner:users!files_owner_id_fkey(public_encryption_key)"
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
    owner: { public_encryption_key: string } | null;
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
