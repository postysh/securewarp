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
  created_at: string;
  updated_at: string;
}

export interface FileKeyRow {
  file_id: string;
  user_id: string;
  encrypted_session_key: string;
}

export async function createFile(data: {
  ownerId: string;
  parentId: string | null;
  encryptedMetadata: string;
  isFolder: boolean;
  sizeBytes: number;
  storageKey: string | null;
  encryptionNonce?: string;
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
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create file: ${error.message}`);
  return file;
}

export async function createFileKey(data: {
  fileId: string;
  userId: string;
  encryptedSessionKey: string;
}): Promise<void> {
  const { error } = await supabase
    .from("file_keys")
    .insert({
      file_id: data.fileId,
      user_id: data.userId,
      encrypted_session_key: data.encryptedSessionKey,
    });

  if (error) throw new Error(`Failed to create file key: ${error.message}`);
}

export async function getFilesForUser(userId: string, parentId: string | null): Promise<(FileRow & { encrypted_session_key: string })[]> {
  let query = supabase
    .from("files")
    .select("*, file_keys!inner(encrypted_session_key)")
    .eq("file_keys.user_id", userId);

  if (parentId) {
    query = query.eq("parent_id", parentId);
  } else {
    query = query.is("parent_id", null);
  }

  const { data, error } = await query.order("is_folder", { ascending: false }).order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch files: ${error.message}`);

  return (data || []).map((row: Record<string, unknown>) => {
    const fileKeys = row.file_keys as { encrypted_session_key: string }[];
    const { file_keys: _, ...rest } = row;
    return {
      ...rest,
      encrypted_session_key: fileKeys[0]?.encrypted_session_key || "",
    } as unknown as FileRow & { encrypted_session_key: string };
  });
}

export async function getFileById(fileId: string, userId: string): Promise<(FileRow & { encrypted_session_key: string }) | null> {
  const { data, error } = await supabase
    .from("files")
    .select("*, file_keys!inner(encrypted_session_key)")
    .eq("id", fileId)
    .eq("file_keys.user_id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch file: ${error.message}`);
  }

  if (!data) return null;

  const dataObj = data as Record<string, unknown>;
  const fileKeys = dataObj.file_keys as { encrypted_session_key: string }[];
  const { file_keys: _, ...rest } = dataObj;
  return {
    ...rest,
    encrypted_session_key: fileKeys[0]?.encrypted_session_key || "",
  } as unknown as FileRow & { encrypted_session_key: string };
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
}): Promise<FileRow> {
  return createFile({
    ownerId: data.ownerId,
    parentId: data.parentId,
    encryptedMetadata: data.encryptedMetadata,
    isFolder: true,
    sizeBytes: 0,
    storageKey: null,
  });
}
