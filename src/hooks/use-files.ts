"use client";

import { createContext, useContext, useState, useCallback, useRef } from "react";
import {
  generateSessionKey,
  encryptMetadata,
  decryptMetadata,
  generateHierarchicalKeypair,
  wrapSessionKeyToFile,
  unwrapSessionKeyFromFile,
  wrapPrivateHierarchicalKeyForUser,
  unwrapPrivateHierarchicalKey,
  wrapParentKeysClaim,
  unwrapParentKeysClaim,
  generateLinkKey,
  wrapPrivateHierarchicalKeyForLink,
  encodeLinkKeyForFragment,
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

export interface FileCollaboratorPreview {
  userId: string;
  email: string;
  isOwner: boolean;
  permissionLevel: PermissionLevel | "owner";
}

export interface DecryptedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  uploading?: boolean;
  uploadProgress?: number;
  isFolder: boolean;
  parentId: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  // Phase 2 hierarchical key payload, passed through from the server so
  // downstream actions (share, download) can re-use it without refetching.
  // For inherited children (Phase 3) `encryptedPrivateHierarchicalKey` and
  // `wrappedByPublicKey` are empty strings — the client walked the
  // parent_keys_claim chain to decrypt this row.
  encryptedPrivateHierarchicalKey: string;
  wrappedByPublicKey: string;
  ownerPublicKey: string;
  publicHierarchicalKey: string;
  encryptedSessionKeyByFile: string;
  sessionKeyNonce: string;
  // Phase 3 parent_keys_claim. Non-null for any file with a parent.
  parentKeysClaim: string | null;
  parentKeysClaimWrappedBy: string | null;
  isShared: boolean;
  // Everyone who holds a wrapped hierarchical-private-key for this file,
  // owner first. Empty array if the file hasn't finished uploading or we
  // haven't loaded the enriched list response yet.
  collaborators: FileCollaboratorPreview[];
}

export type ViewMode = "own" | "shared";

export type PermissionLevel = "editor" | "viewer";

interface FileListCollabShape {
  userId: string;
  email: string;
  isOwner: boolean;
  permissionLevel: PermissionLevel | "owner";
}

export interface Collaborator {
  userId: string;
  email: string;
  publicEncryptionKey: string;
  isOwner: boolean;
  permissionLevel: PermissionLevel | "owner";
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
  viewMode: ViewMode;
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
    viewMode: "own",
  });
  const [initialized, setInitialized] = useState(false);

  // Phase 3 — cache of folder hierarchical keypair material, keyed by
  // folder id. Populated as the decrypt loop encounters folders. Two use
  // cases:
  //   - `privateHierarchicalKey` unwraps inherited children's
  //     parent_keys_claim on the next fetchFiles call inside that folder.
  //   - `publicHierarchicalKey` is needed when uploading a new child into
  //     the folder (wrapParentKeysClaim needs the parent's pub hier key).
  // Ref (not state) so it survives re-renders and doesn't retrigger
  // fetchFiles. Scoped to the hook instance — cleared when the provider
  // unmounts on logout.
  const folderPrivHierCache = useRef<
    Map<string, { publicHierarchicalKey: string; privateHierarchicalKey: string }>
  >(new Map());

  const fetchFiles = useCallback(
    async (parentId: string | null = null, mode: ViewMode = "own") => {
      if (!keys) return;
      const isFirstLoad = !initialized;
      setState((s) => ({ ...s, loading: isFirstLoad, error: null }));
      setInitialized(true);

      try {
        const url =
          mode === "shared"
            ? "/api/files/list?shared=true"
            : parentId
              ? `/api/files/list?parentId=${parentId}`
              : "/api/files/list";
        const res = await fetch(url);
        const data = await res.json();

        if (!res.ok) {
          setState((s) => ({ ...s, loading: false, error: data.error }));
          return;
        }

        const decrypted: DecryptedFile[] = data.files.map((f: Record<string, unknown>) => {
          const encryptedPrivHier = (f.encrypted_private_hierarchical_key as string) || "";
          const wrappedByPublicKey = (f.wrapped_by_public_key as string) || "";
          const ownerPublicKey = (f.owner_public_key as string) || "";
          const publicHierarchicalKey = (f.public_hierarchical_key as string) || "";
          const encryptedSessionKeyByFile = (f.encrypted_session_key_by_file as string) || "";
          const sessionKeyNonce = (f.session_key_nonce as string) || "";
          const parentKeysClaim = (f.parent_keys_claim as string | null) ?? null;
          const parentKeysClaimWrappedBy = (f.parent_keys_claim_wrapped_by as string | null) ?? null;
          const rowParentId = (f.parent_id as string | null) ?? null;
          const isFolder = f.is_folder as boolean;

          const base = {
            id: f.id as string,
            isFolder,
            parentId: rowParentId,
            ownerId: (f.owner_id as string) || "",
            createdAt: f.created_at as string,
            updatedAt: f.updated_at as string,
            encryptedPrivateHierarchicalKey: encryptedPrivHier,
            wrappedByPublicKey,
            ownerPublicKey,
            publicHierarchicalKey,
            encryptedSessionKeyByFile,
            sessionKeyNonce,
            parentKeysClaim,
            parentKeysClaimWrappedBy,
            isShared: mode === "shared",
            collaborators: (f.collaborators as FileListCollabShape[] | undefined) ?? [],
          };

          try {
            let sessionKey: Uint8Array;
            let privHier: string | null = null;

            if (encryptedPrivHier) {
              // Direct-row path: owner or direct collaborator. Unwrap the
              // caller's private-hier-key row, then the session key.
              privHier = unwrapPrivateHierarchicalKey(
                encryptedPrivHier,
                wrappedByPublicKey,
                keys.encryptionPrivateKey
              );
              sessionKey = unwrapSessionKeyFromFile(
                encryptedSessionKeyByFile,
                sessionKeyNonce,
                ownerPublicKey,
                privHier
              );
            } else if (parentKeysClaim && parentKeysClaimWrappedBy && rowParentId) {
              // Phase 3 inherited path: no direct row, walk the parent
              // chain. The parent's priv hier key must already be in the
              // cache (populated earlier in this same decrypt loop, or on
              // a previous fetchFiles when the caller loaded the parent).
              const parentEntry = folderPrivHierCache.current.get(rowParentId);
              if (!parentEntry) {
                throw new Error(`parent priv hier not cached for ${rowParentId}`);
              }
              const unwrapped = unwrapParentKeysClaim(
                parentKeysClaim,
                parentKeysClaimWrappedBy,
                parentEntry.privateHierarchicalKey
              );
              sessionKey = unwrapped.sessionKey;
              privHier = unwrapped.childPrivateHierarchicalKey;
            } else {
              throw new Error("no decrypt path: neither direct row nor parent claim");
            }

            // Populate the folder cache so descendants can walk through
            // this row on their own decrypt pass AND uploads into this
            // folder can wrap parent_keys_claim against its pub hier key.
            if (isFolder && privHier && publicHierarchicalKey) {
              folderPrivHierCache.current.set(f.id as string, {
                publicHierarchicalKey,
                privateHierarchicalKey: privHier,
              });
            }

            const encMeta = typeof f.encrypted_metadata === "string"
              ? JSON.parse(f.encrypted_metadata as string)
              : f.encrypted_metadata;
            const meta = decryptMetadata(encMeta, sessionKey);

            sessionKey.fill(0);

            return {
              ...base,
              name: meta.name,
              type: meta.type,
              size: meta.size,
            } as DecryptedFile;
          } catch (err) {
            console.error("Failed to decrypt file:", f.id, err);
            return {
              ...base,
              name: "[Encrypted]",
              type: "unknown",
              size: 0,
            } as DecryptedFile;
          }
        });

        setState((s) => ({
          ...s,
          files: decrypted,
          loading: false,
          currentFolder: mode === "shared" ? null : parentId,
          viewMode: mode,
          breadcrumb:
            mode === "shared"
              ? [{ id: null, name: "Shared with me" }]
              : s.viewMode === "shared" && mode === "own"
                ? [{ id: null, name: "My Drive" }]
                : s.breadcrumb,
        }));
      } catch (err) {
        console.error("Fetch files error:", err);
        setState((s) => ({ ...s, loading: false, error: "Failed to load files" }));
      }
    },
    [keys, initialized]
  );

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
      ownerId: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      encryptedPrivateHierarchicalKey: "",
      wrappedByPublicKey: keys.encryptionPublicKey,
      ownerPublicKey: keys.encryptionPublicKey,
      publicHierarchicalKey: "",
      encryptedSessionKeyByFile: "",
      sessionKeyNonce: "",
      parentKeysClaim: null,
      parentKeysClaimWrappedBy: null,
      isShared: false,
      collaborators: [],
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
      // 1. Generate the symmetric session key + the file's hierarchical
      //    keypair, then encrypt metadata with the session key.
      updateProgress(8, "Generating encryption keys...");
      const sessionKey = generateSessionKey();
      const hier = generateHierarchicalKeypair();

      const encryptedMetadata = encryptMetadata(
        { name: file.name, type: file.type || "application/octet-stream", size: file.size },
        sessionKey
      );

      // 1a. Wrap the session key to the file's public hier key using the
      //     owner's private key as the box sender.
      const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
        sessionKey,
        hier.publicKey,
        keys.encryptionPrivateKey
      );
      // 1b. Wrap the file's private hier key to the owner's own public
      //     key. This is the row that lives in file_keys and is what
      //     collaborators unwrap after being granted access.
      const encryptedPrivateHierarchicalKey = wrapPrivateHierarchicalKeyForUser(
        hier.privateKey,
        keys.encryptionPublicKey,
        keys.encryptionPrivateKey
      );

      // 1c. Phase 3: if this file has a parent, wrap {sessionKey, childPriv}
      //     under the parent's public hier key so anyone with access to
      //     the parent can transitively unwrap this child. The parent's
      //     hier material is cached during decryption when the user
      //     navigated into the folder, so it's in memory without an
      //     extra round-trip.
      let parentKeysClaim: string | undefined;
      let parentKeysClaimWrappedBy: string | undefined;
      if (parentId) {
        const parentEntry = folderPrivHierCache.current.get(parentId);
        if (!parentEntry) {
          throw new Error(
            "Parent folder not loaded — navigate into the folder before uploading into it"
          );
        }
        parentKeysClaim = wrapParentKeysClaim(
          sessionKey,
          hier.privateKey,
          parentEntry.publicHierarchicalKey,
          keys.encryptionPrivateKey
        );
        parentKeysClaimWrappedBy = keys.encryptionPublicKey;
      }

      // 2. Initialize chunked upload — get presigned URLs for all chunks
      updateProgress(12, "Preparing upload...");
      const initRes = await fetch("/api/files/chunk-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "init",
          encryptedMetadata: JSON.stringify(encryptedMetadata),
          parentId,
          totalSizeBytes: file.size,
          chunkCount,
          publicHierarchicalKey: hier.publicKey,
          encryptedSessionKeyByFile,
          sessionKeyNonce,
          encryptedPrivateHierarchicalKey,
          wrappedByPublicKey: keys.encryptionPublicKey,
          parentKeysClaim,
          parentKeysClaimWrappedBy,
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

      // 2. Two-step unwrap: our file_keys row → file's private hier key →
      //    session key wrapped to the file's pub hier key by the owner.
      const privHier = unwrapPrivateHierarchicalKey(
        data.encryptedPrivateHierarchicalKey,
        data.wrappedByPublicKey,
        keys.encryptionPrivateKey
      );
      const sessionKey = unwrapSessionKeyFromFile(
        data.encryptedSessionKeyByFile,
        data.sessionKeyNonce,
        data.ownerPublicKey,
        privHier
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
      const hier = generateHierarchicalKeypair();

      const encryptedMetadata = encryptMetadata(
        { name, type: "folder", size: 0 },
        sessionKey
      );

      const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
        sessionKey,
        hier.publicKey,
        keys.encryptionPrivateKey
      );
      const encryptedPrivateHierarchicalKey = wrapPrivateHierarchicalKeyForUser(
        hier.privateKey,
        keys.encryptionPublicKey,
        keys.encryptionPrivateKey
      );

      // Phase 3: same parent-claim generation as uploadFile.
      let parentKeysClaim: string | undefined;
      let parentKeysClaimWrappedBy: string | undefined;
      if (parentId) {
        const parentEntry = folderPrivHierCache.current.get(parentId);
        if (!parentEntry) {
          setState((s) => ({
            ...s,
            error: "Parent folder not loaded — navigate into it before creating a subfolder",
          }));
          sessionKey.fill(0);
          return;
        }
        parentKeysClaim = wrapParentKeysClaim(
          sessionKey,
          hier.privateKey,
          parentEntry.publicHierarchicalKey,
          keys.encryptionPrivateKey
        );
        parentKeysClaimWrappedBy = keys.encryptionPublicKey;
      }

      const res = await fetch("/api/files/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedMetadata: JSON.stringify(encryptedMetadata),
          parentId,
          publicHierarchicalKey: hier.publicKey,
          encryptedSessionKeyByFile,
          sessionKeyNonce,
          encryptedPrivateHierarchicalKey,
          wrappedByPublicKey: keys.encryptionPublicKey,
          parentKeysClaim,
          parentKeysClaimWrappedBy,
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

      await fetchFiles(state.currentFolder, state.viewMode);
    } catch (err) {
      console.error("Delete error:", err);
      setState((s) => ({ ...s, error: "Delete failed" }));
    }
  }, [fetchFiles, state.currentFolder, state.viewMode]);

  /**
   * Grant a user access to a file by re-wrapping its session key to their
   * public encryption key. Client-side only — the server never sees the raw
   * session key. Requires the caller to hold valid decryption keys.
   */
  const shareFile = useCallback(
    async (
      file: DecryptedFile,
      recipientEmail: string,
      permissionLevel: PermissionLevel = "editor"
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!keys) return { ok: false, error: "Not signed in" };

      try {
        // 1. Look up recipient's public encryption key.
        const pkRes = await fetch(`/api/users/public-key?email=${encodeURIComponent(recipientEmail)}`);
        const pkData = await pkRes.json();
        if (!pkRes.ok) return { ok: false, error: pkData.error || "User not found" };

        // 2. Unwrap our own file_keys row to recover the file's private
        //    hierarchical key. We hold it whether we're the owner or a
        //    prior collaborator — Phase 2 allows either to re-share.
        const privHier = unwrapPrivateHierarchicalKey(
          file.encryptedPrivateHierarchicalKey,
          file.wrappedByPublicKey,
          keys.encryptionPrivateKey
        );

        // 3. Wrap it to the recipient's public key, with our private key
        //    as the box sender. The recipient will use our public key
        //    (passed as `wrappedByPublicKey`) to unwrap.
        const encryptedForRecipient = wrapPrivateHierarchicalKeyForUser(
          privHier,
          pkData.publicEncryptionKey,
          keys.encryptionPrivateKey
        );

        // 4. Send the wrapped key to the server.
        const res = await fetch("/api/files/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileId: file.id,
            recipientEmail,
            encryptedPrivateHierarchicalKey: encryptedForRecipient,
            wrappedByPublicKey: keys.encryptionPublicKey,
            permissionLevel,
          }),
        });

        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.error || "Share failed" };
        return { ok: true };
      } catch (err) {
        console.error("Share error:", err);
        return { ok: false, error: "Share failed — check your keys and try again" };
      }
    },
    [keys]
  );

  /**
   * Revoke a collaborator. Owners can remove anyone; collaborators can only
   * remove themselves ("leave share"). Phase 1 does not rotate the session
   * key, so this is ACL revocation only — see README for forward-secrecy
   * caveat.
   */
  const unshareFile = useCallback(
    async (fileId: string, userId: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const res = await fetch("/api/files/unshare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId, userId }),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.error || "Unshare failed" };
        return { ok: true };
      } catch (err) {
        console.error("Unshare error:", err);
        return { ok: false, error: "Unshare failed" };
      }
    },
    []
  );

  /**
   * Collaborator removes themselves from a shared file ("remove from
   * shared with me"). Distinct from unshare — no target user, and the
   * server rejects the call if the caller owns the file.
   */
  const leaveShare = useCallback(
    async (fileId: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const res = await fetch("/api/files/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId }),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.error || "Failed to remove" };
        return { ok: true };
      } catch (err) {
        console.error("Leave share error:", err);
        return { ok: false, error: "Failed to remove" };
      }
    },
    []
  );

  /**
   * Owner changes a collaborator's permission level. No key rotation —
   * Phase 1 enforcement is server-side ACL only.
   */
  const setPermission = useCallback(
    async (
      fileId: string,
      userId: string,
      level: PermissionLevel
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const res = await fetch("/api/files/permission", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId, userId, level }),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.error || "Failed to update" };
        return { ok: true };
      } catch (err) {
        console.error("Permission error:", err);
        return { ok: false, error: "Failed to update" };
      }
    },
    []
  );

  /**
   * Phase 4 — create a public link to a file or folder. Client-side:
   *   1. Unwrap our own private hier key (existing flow via file_keys).
   *   2. Generate a fresh symmetric linkKey (never reaches the server).
   *   3. Wrap the priv hier key under linkKey with nacl.secretbox.
   *   4. POST the ciphertext + nonce to /api/files/link/create.
   *   5. Build the URL with linkKey in the fragment. Return it to the
   *      caller exactly once — after this point there's no way to
   *      recover the linkKey, so the UI must copy it immediately.
   */
  const createLink = useCallback(
    async (
      file: DecryptedFile,
      opts?: { expiresAt?: string }
    ): Promise<{ ok: true; url: string; id: string } | { ok: false; error: string }> => {
      if (!keys) return { ok: false, error: "Not signed in" };
      try {
        const privHier = unwrapPrivateHierarchicalKey(
          file.encryptedPrivateHierarchicalKey,
          file.wrappedByPublicKey,
          keys.encryptionPrivateKey
        );
        const linkKey = generateLinkKey();
        const { encryptedPrivateHierarchicalKey, linkKeyNonce } =
          wrapPrivateHierarchicalKeyForLink(privHier, linkKey);

        const res = await fetch("/api/files/link/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileId: file.id,
            encryptedPrivateHierarchicalKey,
            linkKeyNonce,
            expiresAt: opts?.expiresAt,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          linkKey.fill(0);
          return { ok: false, error: data.error || "Failed to create link" };
        }

        const fragment = encodeLinkKeyForFragment(linkKey);
        linkKey.fill(0);
        return {
          ok: true,
          id: data.id,
          url: `${window.location.origin}/share/${data.id}#${fragment}`,
        };
      } catch (err) {
        console.error("Create link error:", err);
        return { ok: false, error: "Failed to create link" };
      }
    },
    [keys]
  );

  const revokeLink = useCallback(
    async (linkId: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const res = await fetch(`/api/files/link/${linkId}/revoke`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.error || "Failed to revoke" };
        return { ok: true };
      } catch (err) {
        console.error("Revoke link error:", err);
        return { ok: false, error: "Failed to revoke" };
      }
    },
    []
  );

  const listLinks = useCallback(
    async (
      fileId: string
    ): Promise<
      {
        id: string;
        createdBy: string;
        createdAt: string;
        expiresAt: string | null;
        permissionLevel: string;
      }[]
    > => {
      const res = await fetch(`/api/files/link/list?fileId=${fileId}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.links || [];
    },
    []
  );

  const loadCollaborators = useCallback(
    async (fileId: string): Promise<Collaborator[]> => {
      const res = await fetch(`/api/files/collaborators?fileId=${fileId}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.collaborators || [];
    },
    []
  );

  const navigateToFolder = useCallback(async (folderId: string | null, folderName: string) => {
    // Folder navigation is always "own" from the server's perspective —
    // the list endpoint accepts a parentId and decides internally whether
    // the caller owns it or accesses it via an inherited file_keys row.
    // Going back to null switches to the owned-root view.
    if (folderId === null) {
      setState((s) => ({ ...s, currentFolder: null, viewMode: "own", breadcrumb: [{ id: null, name: "My Drive" }] }));
    } else {
      setState((s) => {
        // Guard against double-click / rapid re-entry producing duplicate
        // breadcrumb entries for the same folder ID — the breadcrumb
        // render keys by crumb.id and duplicates crash React.
        const lastCrumb = s.breadcrumb[s.breadcrumb.length - 1];
        if (lastCrumb?.id === folderId) {
          return { ...s, currentFolder: folderId, viewMode: "own" };
        }
        return {
          ...s,
          currentFolder: folderId,
          viewMode: "own",
          breadcrumb:
            s.viewMode === "shared"
              ? [{ id: null, name: "Shared with me" }, { id: folderId, name: folderName }]
              : [...s.breadcrumb, { id: folderId, name: folderName }],
        };
      });
    }
    await fetchFiles(folderId, "own");
  }, [fetchFiles]);

  const navigateToBreadcrumb = useCallback(async (index: number) => {
    setState((s) => ({
      ...s,
      breadcrumb: s.breadcrumb.slice(0, index + 1),
    }));
    const target = state.breadcrumb[index];
    const targetId = target?.id ?? null;
    // Breadcrumb root tells us which view we're returning to. "Shared with
    // me" is the only other root besides "My Drive".
    const rootMode: ViewMode =
      state.breadcrumb[0]?.name === "Shared with me" ? "shared" : "own";
    if (targetId === null && rootMode === "shared") {
      await fetchFiles(null, "shared");
    } else {
      await fetchFiles(targetId, "own");
    }
  }, [fetchFiles, state.breadcrumb]);

  /**
   * Switch between "My Drive" and "Shared with me". Resets folder context.
   */
  const setViewMode = useCallback(
    async (mode: ViewMode) => {
      await fetchFiles(null, mode);
    },
    [fetchFiles]
  );

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
    shareFile,
    unshareFile,
    leaveShare,
    setPermission,
    createLink,
    revokeLink,
    listLinks,
    loadCollaborators,
    setViewMode,
    navigateToFolder,
    navigateToBreadcrumb,
    clearError,
  };
}

export type FilesApi = ReturnType<typeof useFiles>;

/**
 * Context used to share the single useFiles() instance between the sidebar,
 * file browser, and modals — so toggling "Shared with me" in one place
 * updates the file list everywhere without prop drilling.
 */
export const FilesContext = createContext<FilesApi | null>(null);

export function useFilesContext(): FilesApi {
  const ctx = useContext(FilesContext);
  if (!ctx) {
    throw new Error("useFilesContext must be used inside a <FilesContext.Provider>");
  }
  return ctx;
}
