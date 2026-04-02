"use client";

import { useState, useCallback } from "react";
import {
  generateSessionKey,
  encryptMetadata,
  decryptMetadata,
  encryptSessionKeyForUser,
  decryptSessionKey,
} from "@/lib/crypto/file-crypto";
import {
  fileChunkGenerator,
  encryptChunk,
  decryptChunk,
  getChunkCount,
  CHUNK_SIZE,
  MAX_FILE_SIZE_FREE,
  CONCURRENT_CHUNK_UPLOADS,
} from "@/lib/crypto/chunked-encryption";
import { toBase64, fromBase64 } from "@/lib/crypto/utils";

export interface DecryptedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  uploading?: boolean;
  uploadProgress?: number;
  isFolder: boolean;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  encryptedSessionKey: string;
}

interface UseFilesState {
  files: DecryptedFile[];
  loading: boolean;
  uploading: boolean;
  uploadStep: string | null;
  uploadProgress: number;
  error: string | null;
  currentFolder: string | null;
  breadcrumb: { id: string | null; name: string }[];
}

/**
 * Hook for encrypted file operations.
 * Requires the user's decrypted keys to be passed in.
 */
export function useFiles(keys: {
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
} | null) {
  const [state, setState] = useState<UseFilesState>({
    files: [],
    loading: false,
    uploading: false,
    uploadStep: null,
    uploadProgress: 0,
    error: null,
    currentFolder: null,
    breadcrumb: [{ id: null, name: "My Drive" }],
  });
  const [initialized, setInitialized] = useState(false);

  const fetchFiles = useCallback(async (parentId: string | null = null) => {
    if (!keys) return;
    const isFirstLoad = !initialized;
    // Only show loading skeleton on first load, not folder navigation
    setState((s) => ({ ...s, loading: isFirstLoad, error: null }));
    setInitialized(true);

    try {
      const params = parentId ? `?parentId=${parentId}` : "";
      const res = await fetch(`/api/files/list${params}`);
      const data = await res.json();

      if (!res.ok) {
        setState((s) => ({ ...s, loading: false, error: data.error }));
        return;
      }

      // Decrypt metadata for each file
      const decrypted: DecryptedFile[] = data.files.map((f: Record<string, unknown>) => {
        try {
          // Decrypt session key
          const sessionKey = decryptSessionKey(
            f.encrypted_session_key as string,
            keys.encryptionPublicKey, // sender = self for own files
            keys.encryptionPrivateKey
          );

          // Decrypt metadata
          const encMeta = typeof f.encrypted_metadata === "string"
            ? JSON.parse(f.encrypted_metadata as string)
            : f.encrypted_metadata;
          const meta = decryptMetadata(encMeta, sessionKey);

          return {
            id: f.id,
            name: meta.name,
            type: meta.type,
            size: meta.size,
            isFolder: f.is_folder,
            parentId: f.parent_id,
            createdAt: f.created_at,
            updatedAt: f.updated_at,
            encryptedSessionKey: f.encrypted_session_key,
          } as DecryptedFile;
        } catch (err) {
          console.error("Failed to decrypt file:", f.id, err);
          return {
            id: f.id,
            name: "[Encrypted]",
            type: "unknown",
            size: 0,
            isFolder: f.is_folder,
            parentId: f.parent_id,
            createdAt: f.created_at,
            updatedAt: f.updated_at,
            encryptedSessionKey: "",
          } as DecryptedFile;
        }
      });

      setState((s) => ({ ...s, files: decrypted, loading: false, currentFolder: parentId }));
    } catch (err) {
      console.error("Fetch files error:", err);
      setState((s) => ({ ...s, loading: false, error: "Failed to load files" }));
    }
  }, [keys]);

  const uploadFile = useCallback(async (file: File, parentId: string | null = null) => {
    if (!keys) return;

    // Check file size limit
    if (file.size > MAX_FILE_SIZE_FREE) {
      setState((s) => ({ ...s, error: `File too large. Maximum is ${MAX_FILE_SIZE_FREE / 1024 / 1024} MB on the free plan.` }));
      return;
    }

    const tempId = `uploading-${Date.now()}`;
    const chunkCount = getChunkCount(file.size);
    const placeholderFile: DecryptedFile = {
      id: tempId,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      isFolder: false,
      parentId: parentId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      encryptedSessionKey: "",
      uploading: true,
      uploadProgress: 5,
    };

    setState((s) => ({ ...s, uploading: true, uploadStep: "Preparing...", uploadProgress: 5, error: null, files: [...s.files, placeholderFile] }));

    const updateProgress = (progress: number, step: string) => {
      setState((s) => ({
        ...s,
        uploadStep: step,
        uploadProgress: progress,
        files: s.files.map((f) => f.id === tempId ? { ...f, uploadProgress: progress } : f),
      }));
    };

    try {
      // 1. Generate session key and encrypt metadata
      updateProgress(8, "Generating encryption keys...");
      const sessionKey = generateSessionKey();

      const encryptedMetadata = encryptMetadata(
        { name: file.name, type: file.type || "application/octet-stream", size: file.size },
        sessionKey
      );

      const encryptedSessionKey = encryptSessionKeyForUser(
        sessionKey,
        keys.encryptionPublicKey,
        keys.encryptionPrivateKey
      );

      // 2. Initialize chunked upload — get presigned URLs for all chunks
      updateProgress(12, "Preparing upload...");
      const initRes = await fetch("/api/files/chunk-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "init",
          encryptedMetadata: JSON.stringify(encryptedMetadata),
          encryptedSessionKey,
          parentId,
          totalSizeBytes: file.size,
          chunkCount,
        }),
      });

      const initData = await initRes.json();
      if (!initRes.ok) {
        setState((s) => ({ ...s, uploading: false, error: initData.error, files: s.files.filter((f) => f.id !== tempId) }));
        return;
      }

      const { fileId, chunkUrls } = initData;

      // 3. Encrypt and upload chunks with concurrency control
      const uploadProgressBase = 15;
      const uploadProgressRange = 80; // 15% to 95%
      let chunksCompleted = 0;

      // Process chunks with concurrency limit
      const chunkQueue: Promise<void>[] = [];

      for await (const { data: chunkData, index, isFinal } of fileChunkGenerator(file)) {
        const chunkUrl = chunkUrls[index];

        const chunkPromise = (async () => {
          // Encrypt chunk
          const encrypted = encryptChunk(chunkData, index, isFinal, sessionKey);

          // Upload to R2
          const r2Res = await fetch(chunkUrl.uploadUrl, {
            method: "PUT",
            body: encrypted.ciphertext as unknown as BodyInit,
            headers: { "Content-Type": "application/octet-stream" },
          });

          if (!r2Res.ok) throw new Error(`Chunk ${index} upload failed`);

          // Register chunk with server
          await fetch("/api/files/chunk-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "chunk",
              fileId,
              sequence: index,
              isFinal,
              sizeBytes: encrypted.sizeBytes,
              storageKey: chunkUrl.storageKey,
              encryptionNonce: encrypted.nonce,
            }),
          });

          chunksCompleted++;
          const progress = uploadProgressBase + Math.round((chunksCompleted / chunkCount) * uploadProgressRange);
          updateProgress(progress, "Uploading to secure storage...");
        })();

        chunkQueue.push(chunkPromise);

        // Limit concurrency
        if (chunkQueue.length >= CONCURRENT_CHUNK_UPLOADS) {
          await Promise.race(chunkQueue);
          // Remove completed promises
          for (let i = chunkQueue.length - 1; i >= 0; i--) {
            const settled = await Promise.race([chunkQueue[i].then(() => true), Promise.resolve(false)]);
            if (settled) chunkQueue.splice(i, 1);
          }
        }
      }

      // Wait for remaining chunks
      await Promise.all(chunkQueue);

      // 4. Finalize
      updateProgress(96, "Finalizing...");
      await fetch("/api/files/chunk-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finalize", fileId }),
      });

      // 5. Clean up
      sessionKey.fill(0);

      updateProgress(100, "Done");
      await new Promise((r) => setTimeout(r, 400));
      setState((s) => ({
        ...s,
        uploading: false,
        uploadStep: null,
        uploadProgress: 0,
        files: s.files.filter((f) => f.id !== tempId),
      }));
      await fetchFiles(parentId);
    } catch (err) {
      console.error("Upload error:", err);
      setState((s) => ({ ...s, uploading: false, error: "Upload failed", files: s.files.filter((f) => f.id !== tempId) }));
    }
  }, [keys, fetchFiles]);

  const downloadFile = useCallback(async (fileId: string) => {
    if (!keys) return;

    try {
      // 1. Get download info
      const res = await fetch(`/api/files/chunk-download?fileId=${fileId}`);
      const data = await res.json();

      if (!res.ok) {
        setState((s) => ({ ...s, error: data.error }));
        return;
      }

      // 2. Decrypt session key
      const sessionKey = decryptSessionKey(
        data.encryptedSessionKey,
        keys.encryptionPublicKey,
        keys.encryptionPrivateKey
      );

      // 3. Decrypt metadata
      const encMeta = typeof data.encryptedMetadata === "string"
        ? JSON.parse(data.encryptedMetadata)
        : data.encryptedMetadata;
      const meta = decryptMetadata(encMeta, sessionKey);

      let decryptedContent: Uint8Array;

      if (data.chunked) {
        // 4a. Chunked download — download and decrypt each chunk, reassemble
        const chunks = data.chunks as { sequence: number; downloadUrl: string; encryptionNonce: string; isFinal: boolean }[];
        const decryptedChunks: Uint8Array[] = [];

        for (const chunk of chunks) {
          const r2Res = await fetch(chunk.downloadUrl);
          const encrypted = new Uint8Array(await r2Res.arrayBuffer());
          const decrypted = decryptChunk(encrypted, chunk.encryptionNonce, chunk.sequence, chunk.isFinal, sessionKey);
          decryptedChunks.push(decrypted);
        }

        // Reassemble
        const totalSize = decryptedChunks.reduce((sum, c) => sum + c.length, 0);
        decryptedContent = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of decryptedChunks) {
          decryptedContent.set(chunk, offset);
          offset += chunk.length;
        }
      } else {
        // 4b. Legacy single-blob download
        const r2Res = await fetch(data.downloadUrl);
        const encrypted = new Uint8Array(await r2Res.arrayBuffer());
        const { decryptFileContent } = await import("@/lib/crypto/file-crypto");
        decryptedContent = decryptFileContent(encrypted, data.encryptionNonce, sessionKey);
      }

      // 5. Create download
      const blob = new Blob([new Uint8Array(decryptedContent)], { type: meta.type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = meta.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // 6. Zero out
      sessionKey.fill(0);
    } catch (err) {
      console.error("Download error:", err);
      setState((s) => ({ ...s, error: "Download failed" }));
    }
  }, [keys]);

  const createFolder = useCallback(async (name: string, parentId: string | null = null) => {
    if (!keys) return;

    try {
      const sessionKey = generateSessionKey();

      const encryptedMetadata = encryptMetadata(
        { name, type: "folder", size: 0 },
        sessionKey
      );

      const encryptedSessionKey = encryptSessionKeyForUser(
        sessionKey,
        keys.encryptionPublicKey,
        keys.encryptionPrivateKey
      );

      const res = await fetch("/api/files/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedMetadata: JSON.stringify(encryptedMetadata),
          encryptedSessionKey,
          parentId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setState((s) => ({ ...s, error: data.error }));
        return;
      }

      sessionKey.fill(0);
      await fetchFiles(parentId);
    } catch (err) {
      console.error("Create folder error:", err);
      setState((s) => ({ ...s, error: "Failed to create folder" }));
    }
  }, [keys, fetchFiles]);

  const deleteItem = useCallback(async (fileId: string) => {
    try {
      const res = await fetch("/api/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });

      if (!res.ok) {
        const data = await res.json();
        setState((s) => ({ ...s, error: data.error }));
        return;
      }

      await fetchFiles(state.currentFolder);
    } catch (err) {
      console.error("Delete error:", err);
      setState((s) => ({ ...s, error: "Delete failed" }));
    }
  }, [fetchFiles, state.currentFolder]);

  const navigateToFolder = useCallback(async (folderId: string | null, folderName: string) => {
    if (folderId === null) {
      setState((s) => ({ ...s, currentFolder: null, breadcrumb: [{ id: null, name: "My Drive" }] }));
    } else {
      setState((s) => ({
        ...s,
        currentFolder: folderId,
        breadcrumb: [...s.breadcrumb, { id: folderId, name: folderName }],
      }));
    }
    await fetchFiles(folderId);
  }, [fetchFiles]);

  const navigateToBreadcrumb = useCallback(async (index: number) => {
    setState((s) => ({
      ...s,
      breadcrumb: s.breadcrumb.slice(0, index + 1),
    }));
    const targetId = state.breadcrumb[index]?.id ?? null;
    await fetchFiles(targetId);
  }, [fetchFiles, state.breadcrumb]);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  return {
    ...state,
    initialized,
    fetchFiles,
    uploadFile,
    downloadFile,
    createFolder,
    deleteItem,
    navigateToFolder,
    navigateToBreadcrumb,
    clearError,
  };
}
