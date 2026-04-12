"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
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
  wrapLinkKeyWithPassword,
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
import { decryptFileContent } from "@/lib/crypto/file-crypto";
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
  isStarred: boolean;
  fileLabels: { id: string; name: string; color: string }[];
  isShared: boolean;
  // Everyone who holds a wrapped hierarchical-private-key for this file,
  // owner first. Empty array if the file hasn't finished uploading or we
  // haven't loaded the enriched list response yet.
  collaborators: FileCollaboratorPreview[];
}

export type ViewMode = "own" | "shared" | "trash" | "starred" | "recent";

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
  callerPermission: string | null;
  // Active workspace context. When set, "My Drive" means the
  // workspace root, not the personal root.
  activeWorkspace: { id: string; rootFolderId: string; name: string } | null;
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
    callerPermission: null,
    activeWorkspace: null,
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
  // fetchFiles. Security lifecycle rules:
  //   - Cleared whenever `keys` identity changes — a new user logging in
  //     must never inherit cached material from a prior session.
  //   - Cleared on unmount (logout triggers the provider unmount).
  //   - Not persisted anywhere — memory-only, tab-scoped.
  const folderPrivHierCache = useRef<
    Map<string, { publicHierarchicalKey: string; privateHierarchicalKey: string }>
  >(new Map());

  useEffect(() => {
    // Wipe on key change (which covers logout → login swap) and on
    // unmount. Plaintext private hierarchical keys live here and must
    // not outlive the session they were decrypted in.
    folderPrivHierCache.current = new Map();
    return () => {
      folderPrivHierCache.current = new Map();
    };
  }, [keys]);

  const fetchFiles = useCallback(
    async (parentId: string | null = null, mode: ViewMode = "own") => {
      if (!keys) return;
      const isFirstLoad = !initialized;
      setState((s) => ({ ...s, loading: isFirstLoad, error: null }));
      setInitialized(true);

      try {
        const url =
          mode === "starred"
            ? "/api/files/list?starred=true"
            : mode === "recent"
              ? "/api/files/list?recent=true"
              : mode === "trash"
                ? "/api/files/list?trash=true"
                : mode === "shared"
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

        // Sort folders before files so parent hier keys are cached
        // before any inherited child tries to walk the parent chain.
        // The normal getFilesForUser query does this via ORDER BY
        // is_folder DESC, but starred/recent/trash views order by
        // different columns.
        const sorted = [...data.files].sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
          (b.is_folder ? 1 : 0) - (a.is_folder ? 1 : 0)
        );

        // Decrypt helper — extracted so we can retry on the second pass.
        const tryDecrypt = (f: Record<string, unknown>): DecryptedFile | null => {
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

          let sessionKey: Uint8Array;
          let privHier: string | null = null;

          if (encryptedPrivHier) {
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
            const parentEntry = folderPrivHierCache.current.get(rowParentId);
            if (!parentEntry) return null; // defer to second pass
            const unwrapped = unwrapParentKeysClaim(
              parentKeysClaim,
              parentKeysClaimWrappedBy,
              parentEntry.privateHierarchicalKey
            );
            sessionKey = unwrapped.sessionKey;
            privHier = unwrapped.childPrivateHierarchicalKey;
          } else {
            throw new Error("no decrypt path");
          }

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
            isStarred: !!(f.is_starred),
            fileLabels: (f.file_labels as { id: string; name: string; color: string }[] | undefined) ?? [],
            isShared: mode === "shared",
            collaborators: (f.collaborators as FileListCollabShape[] | undefined) ?? [],
            name: meta.name,
            type: meta.type,
            size: meta.size,
          } as DecryptedFile;
        };

        const makeErrorEntry = (f: Record<string, unknown>): DecryptedFile => ({
          id: f.id as string,
          isFolder: f.is_folder as boolean,
          parentId: (f.parent_id as string | null) ?? null,
          ownerId: (f.owner_id as string) || "",
          createdAt: f.created_at as string,
          updatedAt: f.updated_at as string,
          encryptedPrivateHierarchicalKey: (f.encrypted_private_hierarchical_key as string) || "",
          wrappedByPublicKey: (f.wrapped_by_public_key as string) || "",
          ownerPublicKey: (f.owner_public_key as string) || "",
          publicHierarchicalKey: (f.public_hierarchical_key as string) || "",
          encryptedSessionKeyByFile: (f.encrypted_session_key_by_file as string) || "",
          sessionKeyNonce: (f.session_key_nonce as string) || "",
          parentKeysClaim: (f.parent_keys_claim as string | null) ?? null,
          parentKeysClaimWrappedBy: (f.parent_keys_claim_wrapped_by as string | null) ?? null,
          isStarred: !!(f.is_starred),
          fileLabels: [],
          isShared: mode === "shared",
          collaborators: (f.collaborators as FileListCollabShape[] | undefined) ?? [],
          name: "[Encrypted]",
          type: "unknown",
          size: 0,
        });

        // Two-pass decrypt. First pass processes everything it can
        // and populates folderPrivHierCache. Second pass retries
        // files that couldn't decrypt because their parent wasn't
        // cached yet (ordering issue in starred/recent views).
        const results: DecryptedFile[] = [];
        const deferred: Record<string, unknown>[] = [];
        for (const f of sorted) {
          try {
            const result = tryDecrypt(f);
            if (result) {
              results.push(result);
            } else {
              deferred.push(f);
            }
          } catch (err) {
            console.error("Failed to decrypt file:", f.id, err);
            results.push(makeErrorEntry(f));
          }
        }
        // Second pass: for deferred items whose parent isn't in the
        // result set, fetch the parent on-the-fly to populate the
        // cache. This covers starred/recent views where a child
        // appears without its parent folder.
        if (deferred.length > 0) {
          const missingParentIds = new Set(
            deferred
              .map((f) => (f.parent_id as string | null))
              .filter((pid): pid is string => !!pid && !folderPrivHierCache.current.has(pid))
          );
          for (const pid of missingParentIds) {
            try {
              const parentRes = await fetch(`/api/files/chunk-download?fileId=${pid}`);
              if (parentRes.ok) {
                const pd = await parentRes.json();
                if (pd.encryptedPrivateHierarchicalKey) {
                  const pPrivHier = unwrapPrivateHierarchicalKey(
                    pd.encryptedPrivateHierarchicalKey,
                    pd.wrappedByPublicKey,
                    keys.encryptionPrivateKey
                  );
                  if (pd.publicHierarchicalKey) {
                    folderPrivHierCache.current.set(pid, {
                      publicHierarchicalKey: pd.publicHierarchicalKey,
                      privateHierarchicalKey: pPrivHier,
                    });
                  }
                }
              }
            } catch {
              // Parent fetch failed — child will fall through to error entry
            }
          }
          for (const f of deferred) {
            try {
              const result = tryDecrypt(f);
              results.push(result ?? makeErrorEntry(f));
            } catch (err) {
              console.error("Failed to decrypt file:", f.id, err);
              results.push(makeErrorEntry(f));
            }
          }
        }

        // fetchFiles ONLY updates data fields. Breadcrumb is managed
        // exclusively by callers (setViewMode, navigateToFolder,
        // navigateToWorkspace, navigateToBreadcrumb) BEFORE calling
        // fetchFiles.
        setState((s) => ({
          ...s,
          files: results,
          loading: false,
          callerPermission: data.callerPermission ?? null,
          currentFolder: mode !== "own" ? null : parentId,
          viewMode: mode === "own" && parentId ? s.viewMode : mode,
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
      isStarred: false,
      fileLabels: [],
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

    // Hoist the session key so a `finally` can zero it on every exit
    // path — thrown error, early return, or successful finalize. The
    // session key is the symmetric secret that encrypts the file body
    // and metadata; it must never outlive the upload flow in memory.
    let sessionKey: Uint8Array | null = null;
    try {
      // 1. Generate the symmetric session key + the file's hierarchical
      //    keypair, then encrypt metadata with the session key.
      updateProgress(8, "Generating encryption keys...");
      sessionKey = generateSessionKey();
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
        let parentEntry = folderPrivHierCache.current.get(parentId);
        if (!parentEntry) {
          try {
            const pRes = await fetch(`/api/files/chunk-download?fileId=${parentId}`);
            if (pRes.ok) {
              const pd = await pRes.json();
              const pKey = pd.encryptedPrivateHierarchicalKey;
              if (pKey) {
                const pPrivHier = unwrapPrivateHierarchicalKey(pKey, pd.wrappedByPublicKey, keys.encryptionPrivateKey);
                parentEntry = { publicHierarchicalKey: pd.publicHierarchicalKey, privateHierarchicalKey: pPrivHier };
                folderPrivHierCache.current.set(parentId, parentEntry);
              }
            }
          } catch { /* fall through */ }
        }
        if (!parentEntry) {
          throw new Error("Cannot access parent folder");
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
    } finally {
      // Zero the session key on every exit path — success, error, or
      // early return. Strings (hier keys, wrappedBy) are GC'd by the
      // runtime; typed-array secrets must be cleared explicitly.
      if (sessionKey) sessionKey.fill(0);
    }
  }, [keys, fetchFiles]);

  /**
   * Unwrap the session key from a chunk-download response. Handles
   * both the direct path (user has a file_keys row on this file) and
   * the inherited path (user has a file_keys row on an ancestor
   * folder and walks the parent_keys_claim chain down).
   */
  const unwrapSessionKeyFromDownload = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data: any): Uint8Array => {
      if (!keys) throw new Error("Not signed in");
      if (data.encryptedPrivateHierarchicalKey) {
        // Direct path
        const privHier = unwrapPrivateHierarchicalKey(
          data.encryptedPrivateHierarchicalKey,
          data.wrappedByPublicKey,
          keys.encryptionPrivateKey
        );
        return unwrapSessionKeyFromFile(
          data.encryptedSessionKeyByFile,
          data.sessionKeyNonce,
          data.ownerPublicKey,
          privHier
        );
      }
      // Inherited path: walk the parent chain from the ancestor down
      if (!data.ancestorKey || !data.parentChain?.length) {
        throw new Error("No decryption path available");
      }
      // Start from the ancestor's direct key
      let currentPrivHier = unwrapPrivateHierarchicalKey(
        data.ancestorKey.encrypted_private_hierarchical_key,
        data.ancestorKey.wrapped_by_public_key,
        keys.encryptionPrivateKey
      );
      // Walk chain from top (closest to ancestor) to bottom (the file)
      for (const link of data.parentChain) {
        const unwrapped = unwrapParentKeysClaim(
          link.parentKeysClaim,
          link.parentKeysClaimWrappedBy,
          currentPrivHier
        );
        currentPrivHier = unwrapped.childPrivateHierarchicalKey;
        // If this is the target file, unwrapped.sessionKey is what we need
        if (link.fileId === data.parentChain[data.parentChain.length - 1].fileId) {
          return unwrapped.sessionKey;
        }
      }
      // If the chain was length 1, the loop returned above.
      // Fallback: use the last unwrapped privHier to get the session key
      return unwrapSessionKeyFromFile(
        data.encryptedSessionKeyByFile,
        data.sessionKeyNonce,
        data.ownerPublicKey,
        currentPrivHier
      );
    },
    [keys]
  );

  const downloadFile = useCallback(async (fileId: string) => {
    if (!keys) return;
    setState((s) => ({ ...s, error: null }));

    let sessionKey: Uint8Array | null = null;
    try {
      const res = await fetch(`/api/files/chunk-download?fileId=${fileId}`);
      const data = await res.json();

      if (!res.ok) {
        setState((s) => ({ ...s, error: data.error }));
        return;
      }

      sessionKey = unwrapSessionKeyFromDownload(data);

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
    } catch (err) {
      console.error("Download error:", err);
      setState((s) => ({ ...s, error: "Download failed" }));
    } finally {
      if (sessionKey) sessionKey.fill(0);
    }
  }, [keys, unwrapSessionKeyFromDownload]);

  /**
   * Decrypt a file and return a blob URL for inline preview. Same
   * decrypt path as downloadFile but returns the blob instead of
   * triggering a save-to-disk. The caller MUST revoke the blob URL
   * when the preview closes to free memory.
   */
  const previewFile = useCallback(
    async (
      fileId: string,
      onProgress?: (pct: number) => void
    ): Promise<
      { ok: true; blobUrl: string; name: string; type: string } | { ok: false; error: string }
    > => {
      if (!keys) return { ok: false, error: "Not signed in" };

      let sessionKey: Uint8Array | null = null;
      try {
        const res = await fetch(`/api/files/chunk-download?fileId=${fileId}`);
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.error || "Download failed" };

        sessionKey = unwrapSessionKeyFromDownload(data);

        const encMeta =
          typeof data.encryptedMetadata === "string"
            ? JSON.parse(data.encryptedMetadata)
            : data.encryptedMetadata;
        const meta = decryptMetadata(encMeta, sessionKey);

        let decryptedContent: Uint8Array;
        if (data.chunked) {
          const chunks = data.chunks as {
            sequence: number;
            downloadUrl: string;
            encryptionNonce: string;
            isFinal: boolean;
          }[];
          const decryptedChunks: Uint8Array[] = [];
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const r2Res = await fetch(chunk.downloadUrl);
            const encrypted = new Uint8Array(await r2Res.arrayBuffer());
            decryptedChunks.push(
              decryptChunk(
                encrypted,
                chunk.encryptionNonce,
                chunk.sequence,
                chunk.isFinal,
                sessionKey
              )
            );
            onProgress?.(Math.round(((i + 1) / chunks.length) * 100));
          }
          const totalSize = decryptedChunks.reduce((s, c) => s + c.length, 0);
          decryptedContent = new Uint8Array(totalSize);
          let offset = 0;
          for (const c of decryptedChunks) {
            decryptedContent.set(c, offset);
            offset += c.length;
          }
        } else {
          const r2Res = await fetch(data.downloadUrl);
          const encrypted = new Uint8Array(await r2Res.arrayBuffer());
          decryptedContent = decryptFileContent(
            encrypted,
            data.encryptionNonce,
            sessionKey
          );
        }

        const blob = new Blob([new Uint8Array(decryptedContent)], { type: meta.type });
        return { ok: true, blobUrl: URL.createObjectURL(blob), name: meta.name, type: meta.type };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Preview failed";
        return { ok: false, error: message };
      } finally {
        if (sessionKey) sessionKey.fill(0);
      }
    },
    [keys, unwrapSessionKeyFromDownload]
  );

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
        let parentEntry = folderPrivHierCache.current.get(parentId);
        if (!parentEntry) {
          // Cache miss — fetch the parent's key on-the-fly
          try {
            const pRes = await fetch(`/api/files/chunk-download?fileId=${parentId}`);
            if (pRes.ok) {
              const pd = await pRes.json();
              const pKey = pd.encryptedPrivateHierarchicalKey;
              if (pKey) {
                const pPrivHier = unwrapPrivateHierarchicalKey(pKey, pd.wrappedByPublicKey, keys.encryptionPrivateKey);
                parentEntry = { publicHierarchicalKey: pd.publicHierarchicalKey, privateHierarchicalKey: pPrivHier };
                folderPrivHierCache.current.set(parentId, parentEntry);
              }
            }
          } catch { /* fall through */ }
        }
        if (!parentEntry) {
          setState((s) => ({
            ...s,
            error: "Cannot access parent folder",
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

  /**
   * Rename a file or folder. The server never sees the new name —
   * the client re-encrypts `{name, type, size}` under the file's
   * existing session key (no rotation) and ships only the ciphertext.
   * Unwraps the session key via either the direct `file_keys` row or
   * the Phase 3 `parent_keys_claim` chain, matching how the list
   * path decrypts metadata on fetch.
   */
  const renameFile = useCallback(
    async (
      file: DecryptedFile,
      newName: string
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!keys) return { ok: false, error: "Not signed in" };
      const trimmed = newName.trim();
      if (trimmed.length === 0) return { ok: false, error: "Name cannot be empty" };
      if (trimmed === file.name) return { ok: true };

      let sessionKey: Uint8Array | null = null;
      try {
        if (file.encryptedPrivateHierarchicalKey) {
          // Direct-row path — owner or direct collaborator.
          const privHier = unwrapPrivateHierarchicalKey(
            file.encryptedPrivateHierarchicalKey,
            file.wrappedByPublicKey,
            keys.encryptionPrivateKey
          );
          sessionKey = unwrapSessionKeyFromFile(
            file.encryptedSessionKeyByFile,
            file.sessionKeyNonce,
            file.ownerPublicKey,
            privHier
          );
        } else if (file.parentKeysClaim && file.parentKeysClaimWrappedBy && file.parentId) {
          // Inherited (Phase 3) — walk through the parent's cached
          // private hier key. The cache is populated on the fetch that
          // rendered this row, so as long as the user has an open view
          // on the parent folder this works without extra requests.
          const parentEntry = folderPrivHierCache.current.get(file.parentId);
          if (!parentEntry) {
            return { ok: false, error: "Parent folder not loaded — reopen it first" };
          }
          const unwrapped = unwrapParentKeysClaim(
            file.parentKeysClaim,
            file.parentKeysClaimWrappedBy,
            parentEntry.privateHierarchicalKey
          );
          sessionKey = unwrapped.sessionKey;
        } else {
          return { ok: false, error: "No decrypt path for this file" };
        }

        const encryptedMetadata = encryptMetadata(
          { name: trimmed, type: file.type, size: file.size },
          sessionKey
        );

        const res = await fetch(`/api/files/${file.id}/rename`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ encryptedMetadata: JSON.stringify(encryptedMetadata) }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return { ok: false, error: data.error || "Rename failed" };
        }

        // Optimistic local update — no refetch needed, the ciphertext
        // round-trip added nothing the client didn't already compute.
        setState((s) => ({
          ...s,
          files: s.files.map((f) => (f.id === file.id ? { ...f, name: trimmed } : f)),
        }));
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Rename failed";
        return { ok: false, error: message };
      } finally {
        if (sessionKey) sessionKey.fill(0);
      }
    },
    [keys, unwrapSessionKeyFromDownload]
  );

  /**
   * Move a file or folder to a new parent (or to root when
   * `newParentId` is null). Owner-only. Re-wraps
   * `parent_keys_claim` under the new parent's pub hier key on the
   * client — the server never sees the plaintext session key.
   *
   * `destPublicHierarchicalKey` is the destination folder's pub hier
   * key. The move-picker loads it from the list endpoint before
   * calling this function. Pass null when moving to root.
   */
  const moveFile = useCallback(
    async (
      file: DecryptedFile,
      newParentId: string | null,
      destPublicHierarchicalKey: string | null
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!keys) return { ok: false, error: "Not signed in" };
      if (file.parentId === newParentId) return { ok: true };

      let sessionKey: Uint8Array | null = null;
      try {
        let privHier: string;

        if (file.encryptedPrivateHierarchicalKey) {
          privHier = unwrapPrivateHierarchicalKey(
            file.encryptedPrivateHierarchicalKey,
            file.wrappedByPublicKey,
            keys.encryptionPrivateKey
          );
          sessionKey = unwrapSessionKeyFromFile(
            file.encryptedSessionKeyByFile,
            file.sessionKeyNonce,
            file.ownerPublicKey,
            privHier
          );
        } else if (file.parentKeysClaim && file.parentKeysClaimWrappedBy && file.parentId) {
          const parentEntry = folderPrivHierCache.current.get(file.parentId);
          if (!parentEntry) {
            return { ok: false, error: "Parent folder not loaded — reopen it first" };
          }
          const unwrapped = unwrapParentKeysClaim(
            file.parentKeysClaim,
            file.parentKeysClaimWrappedBy,
            parentEntry.privateHierarchicalKey
          );
          sessionKey = unwrapped.sessionKey;
          privHier = unwrapped.childPrivateHierarchicalKey;
        } else {
          return { ok: false, error: "No decrypt path for this file" };
        }

        let parentKeysClaim: string | null = null;
        let parentKeysClaimWrappedBy: string | null = null;
        if (newParentId !== null) {
          if (!destPublicHierarchicalKey) {
            return { ok: false, error: "Destination pub hier key missing" };
          }
          parentKeysClaim = wrapParentKeysClaim(
            sessionKey,
            privHier,
            destPublicHierarchicalKey,
            keys.encryptionPrivateKey
          );
          parentKeysClaimWrappedBy = keys.encryptionPublicKey;
        }

        const res = await fetch(`/api/files/${file.id}/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newParentId, parentKeysClaim, parentKeysClaimWrappedBy }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return { ok: false, error: data.error || "Move failed" };
        }

        await fetchFiles(state.currentFolder, state.viewMode);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Move failed";
        return { ok: false, error: message };
      } finally {
        if (sessionKey) sessionKey.fill(0);
      }
    },
    [keys, fetchFiles, state.currentFolder, state.viewMode]
  );

  const toggleStar = useCallback(
    async (fileId: string, starred: boolean): Promise<{ ok: boolean }> => {
      try {
        const res = await fetch(`/api/files/${fileId}/star`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starred }),
        });
        if (!res.ok) return { ok: false };
        setState((s) => ({
          ...s,
          files: s.files.map((f) =>
            f.id === fileId ? { ...f, isStarred: starred } : f
          ),
        }));
        return { ok: true };
      } catch {
        return { ok: false };
      }
    },
    []
  );

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
        await fetchFiles(state.currentFolder, state.viewMode);
        return { ok: true };
      } catch (err) {
        console.error("Share error:", err);
        return { ok: false, error: "Share failed — check your keys and try again" };
      }
    },
    [keys, fetchFiles, state.currentFolder, state.viewMode]
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
        await fetchFiles(state.currentFolder, state.viewMode);
        return { ok: true };
      } catch (err) {
        console.error("Unshare error:", err);
        return { ok: false, error: "Unshare failed" };
      }
    },
    [fetchFiles, state.currentFolder, state.viewMode]
  );

  /**
   * Phase 5 — forward-secret revocation. Owner-only, single file only.
   *
   * Rotates the file's hierarchical keypair + session key, re-encrypts
   * every chunk, re-wraps the new private hier key for each remaining
   * collaborator, and finally deletes the revoked user's file_keys row.
   * After this completes, any ciphertext the revoked user cached (their
   * old private hier key, the old session key, the old encrypted chunks)
   * is useless against the current state of the file.
   *
   * Folder rotation is rejected — it requires a recursive
   * parent_keys_claim re-wrap across the whole descendant set, which
   * hasn't been implemented yet.
   */
  const rotateAndRevoke = useCallback(
    async (
      file: DecryptedFile,
      revokedUserId: string
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!keys) return { ok: false, error: "Not signed in" };
      if (file.isFolder) {
        return { ok: false, error: "Folder rotation isn't supported yet" };
      }
      if (revokedUserId === file.ownerId) {
        return { ok: false, error: "Cannot revoke the owner" };
      }

      try {
        // 1. Download + decrypt + reassemble current plaintext.
        const dlRes = await fetch(`/api/files/chunk-download?fileId=${file.id}`);
        const dlData = await dlRes.json();
        if (!dlRes.ok) return { ok: false, error: dlData.error || "Download failed" };

        const oldPrivHier = unwrapPrivateHierarchicalKey(
          dlData.encryptedPrivateHierarchicalKey,
          dlData.wrappedByPublicKey,
          keys.encryptionPrivateKey
        );
        const oldSessionKey = unwrapSessionKeyFromFile(
          dlData.encryptedSessionKeyByFile,
          dlData.sessionKeyNonce,
          dlData.ownerPublicKey,
          oldPrivHier
        );

        let plaintext: Uint8Array;
        if (dlData.chunked) {
          const chunks = dlData.chunks as {
            sequence: number;
            downloadUrl: string;
            encryptionNonce: string;
            isFinal: boolean;
          }[];
          const decryptedChunks: Uint8Array[] = [];
          for (const chunk of chunks) {
            const r2 = await fetch(chunk.downloadUrl);
            const encrypted = new Uint8Array(await r2.arrayBuffer());
            decryptedChunks.push(
              decryptChunk(
                encrypted,
                chunk.encryptionNonce,
                chunk.sequence,
                chunk.isFinal,
                oldSessionKey
              )
            );
          }
          const total = decryptedChunks.reduce((s, c) => s + c.length, 0);
          plaintext = new Uint8Array(total);
          let offset = 0;
          for (const c of decryptedChunks) {
            plaintext.set(c, offset);
            offset += c.length;
          }
        } else {
          const r2 = await fetch(dlData.downloadUrl);
          const encrypted = new Uint8Array(await r2.arrayBuffer());
          plaintext = decryptFileContent(encrypted, dlData.encryptionNonce, oldSessionKey);
        }
        oldSessionKey.fill(0);

        // 2. Generate new keys and re-encrypt metadata.
        const newSessionKey = generateSessionKey();
        const newHier = generateHierarchicalKeypair();
        const encryptedMetadata = encryptMetadata(
          { name: file.name, type: file.type, size: plaintext.length },
          newSessionKey
        );

        const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
          newSessionKey,
          newHier.publicKey,
          keys.encryptionPrivateKey
        );

        // 3. Re-wrap parent_keys_claim if this file has a parent.
        let parentKeysClaim: string | null = null;
        let parentKeysClaimWrappedBy: string | null = null;
        if (file.parentId) {
          const parentEntry = folderPrivHierCache.current.get(file.parentId);
          if (!parentEntry) {
            plaintext.fill(0);
            newSessionKey.fill(0);
            return {
              ok: false,
              error: "Parent folder not loaded — open it before rotating",
            };
          }
          parentKeysClaim = wrapParentKeysClaim(
            newSessionKey,
            newHier.privateKey,
            parentEntry.publicHierarchicalKey,
            keys.encryptionPrivateKey
          );
          parentKeysClaimWrappedBy = keys.encryptionPublicKey;
        }

        // 4. Build remaining-collaborator wraps (owner re-wraps to
        //    themselves, everyone else gets a new per-user wrap).
        type RawCollab = {
          userId: string;
          publicEncryptionKey: string;
          permissionLevel: "owner" | "editor" | "viewer";
          isOwner: boolean;
        };
        const buildRemainingWraps = async () => {
          const currentCollabs = await fetch(
            `/api/files/collaborators?fileId=${file.id}`
          ).then((r) => r.json());
          return (currentCollabs.collaborators as RawCollab[])
            .filter((c) => c.userId !== revokedUserId)
            .map((c) => ({
              userId: c.userId,
              encryptedPrivateHierarchicalKey: wrapPrivateHierarchicalKeyForUser(
                newHier.privateKey,
                c.publicEncryptionKey,
                keys.encryptionPrivateKey
              ),
              wrappedByPublicKey: keys.encryptionPublicKey,
              permissionLevel: c.permissionLevel,
            }));
        };
        let remainingCollaborators = await buildRemainingWraps();

        // 5. Chunk, encrypt, upload. Chunk boundaries are re-derived
        //    from the newly plaintext bytes — the old chunk count and
        //    the new one might differ if CHUNK_SIZE ever changes, but
        //    today they match.
        const totalChunks = Math.ceil(plaintext.length / CHUNK_SIZE) || 1;
        const initRes = await fetch(`/api/files/${file.id}/rotate-init`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chunkCount: totalChunks }),
        });
        const initData = await initRes.json();
        if (!initRes.ok) {
          plaintext.fill(0);
          newSessionKey.fill(0);
          return { ok: false, error: initData.error || "Rotate init failed" };
        }

        const newChunks: {
          sequence: number;
          storageKey: string;
          encryptionNonce: string;
          sizeBytes: number;
          isFinal: boolean;
        }[] = [];
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, plaintext.length);
          const chunkData = plaintext.subarray(start, end);
          const isFinal = i === totalChunks - 1;
          const encrypted = encryptChunk(chunkData, i, isFinal, newSessionKey);
          const target = initData.chunkUrls[i];
          const r2Res = await fetch(target.uploadUrl, {
            method: "PUT",
            body: encrypted.ciphertext as unknown as BodyInit,
            headers: { "Content-Type": "application/octet-stream" },
          });
          if (!r2Res.ok) throw new Error(`Rotate upload failed at chunk ${i}`);
          newChunks.push({
            sequence: i,
            storageKey: target.storageKey,
            encryptionNonce: encrypted.nonce,
            sizeBytes: encrypted.sizeBytes,
            isFinal,
          });
        }

        // 6. Commit the swap. Retry once on 409 — a concurrent share
        //    may have added a new collaborator between buildRemainingWraps
        //    and commit, and the server enforces exact set-equality to
        //    prevent stale rotations from sneaking grants in. Without
        //    the retry the revocation silently fails; with it, we
        //    transparently pick up the new member and re-commit.
        const commitPayload = () => ({
          encryptedMetadata: JSON.stringify(encryptedMetadata),
          publicHierarchicalKey: newHier.publicKey,
          encryptedSessionKeyByFile,
          sessionKeyNonce,
          parentKeysClaim,
          parentKeysClaimWrappedBy,
          newChunks,
          remainingCollaborators,
          revokedUserId,
        });
        let commitRes = await fetch(`/api/files/${file.id}/rotate-commit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(commitPayload()),
        });
        if (commitRes.status === 409) {
          remainingCollaborators = await buildRemainingWraps();
          commitRes = await fetch(`/api/files/${file.id}/rotate-commit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(commitPayload()),
          });
        }
        const commitData = await commitRes.json();
        if (!commitRes.ok) {
          plaintext.fill(0);
          newSessionKey.fill(0);
          return {
            ok: false,
            error:
              commitRes.status === 409
                ? "Collaborators keep changing — please try again in a moment"
                : commitData.error || "Rotate commit failed",
          };
        }

        plaintext.fill(0);
        newSessionKey.fill(0);
        await fetchFiles(state.currentFolder, state.viewMode);
        return { ok: true };
      } catch (err) {
        console.error("rotateAndRevoke", err);
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Revoke rotation failed: ${message}` };
      }
    },
    [keys, fetchFiles, state.currentFolder, state.viewMode]
  );

  /**
   * Collaborator removes themselves from a shared file ("remove from
   * shared with me"). Distinct from unshare — no target user, and the
   * server rejects the call if the caller owns the file.
   */
  /**
   * Phase 5.1 — folder shallow rotation.
   *
   * Rotates the folder's own hierarchical keypair + session key, then
   * re-wraps every direct child's `parent_keys_claim` under the new
   * folder pub hier. Descendants below the first level are untouched:
   * their claims were encrypted under THEIR parent's pub hier (which
   * is unchanged for shallow rotation), so any reader who reaches the
   * direct child via the new folder keys then walks further down via
   * the unchanged chain.
   *
   * Known limitation: a revoked user who previously opened and cached
   * a specific descendant's session key or priv hier retains access
   * to that cached copy. Newly added files and uncached descendants
   * are fully protected. See README §"Folder rotation" for the
   * honest threat model.
   *
   * Retries once on 409 (concurrent share or new child since init)
   * with a fresh context fetch.
   */
  const rotateAndRevokeFolder = useCallback(
    async (
      folder: DecryptedFile,
      revokedUserId: string
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!keys) return { ok: false, error: "Not signed in" };
      if (!folder.isFolder) {
        return { ok: false, error: "Use rotateAndRevoke for non-folder files" };
      }
      if (revokedUserId === folder.ownerId) {
        return { ok: false, error: "Cannot revoke the owner" };
      }

      type ChildCtx = {
        id: string;
        parentId: string | null;
        isFolder: boolean;
        publicHierarchicalKey: string;
        parentKeysClaim: string | null;
        parentKeysClaimWrappedBy: string | null;
        encryptedSessionKeyByFile: string;
        sessionKeyNonce: string;
      };
      type CollabCtx = {
        userId: string;
        email: string;
        publicEncryptionKey: string;
        isOwner: boolean;
        permissionLevel: "owner" | "editor" | "viewer";
      };
      type RotateContext = {
        folder: {
          id: string;
          parentId: string | null;
          publicHierarchicalKey: string;
          encryptedSessionKeyByFile: string;
          sessionKeyNonce: string;
        };
        directChildren: ChildCtx[];
        collaborators: CollabCtx[];
      };

      const run = async (): Promise<{ ok: true } | { ok: false; error: string; status?: number }> => {
        // 1. Single roundtrip for folder + children + collaborators.
        const ctxRes = await fetch(
          `/api/files/${folder.id}/folder-rotate-context`
        );
        const ctxData = await ctxRes.json();
        if (!ctxRes.ok) {
          return { ok: false, error: ctxData.error || "Context fetch failed" };
        }
        const ctx = ctxData as RotateContext;

        // 2. The caller's current priv hier for the folder. Prefer the
        //    cached value (populated when the user navigated into the
        //    folder); otherwise re-derive from their file_keys row via
        //    the existing DecryptedFile payload.
        const cachedEntry = folderPrivHierCache.current.get(folder.id);
        const oldFolderPrivHier =
          cachedEntry?.privateHierarchicalKey ??
          unwrapPrivateHierarchicalKey(
            folder.encryptedPrivateHierarchicalKey,
            folder.wrappedByPublicKey,
            keys.encryptionPrivateKey
          );

        // 3. Unwrap each direct child via the OLD folder priv hier.
        //    We only need {sessionKey, childPrivHier} from each claim.
        //    Skip children that don't have a claim (shouldn't happen
        //    for children of a parented file_keys row, but be safe).
        type Unwrapped = {
          id: string;
          sessionKey: Uint8Array;
          childPrivateHierarchicalKey: string;
        };
        const unwrapped: Unwrapped[] = [];
        for (const child of ctx.directChildren) {
          if (!child.parentKeysClaim || !child.parentKeysClaimWrappedBy) {
            return {
              ok: false,
              error: `Child ${child.id} is missing parent_keys_claim (unexpected)`,
            };
          }
          const u = unwrapParentKeysClaim(
            child.parentKeysClaim,
            child.parentKeysClaimWrappedBy,
            oldFolderPrivHier
          );
          unwrapped.push({ id: child.id, ...u });
        }

        // 4. Generate new folder keys.
        const newFolderSessionKey = generateSessionKey();
        const newFolderHier = generateHierarchicalKeypair();

        // 5. Re-encrypt the folder's own metadata under the new session key.
        //    Fall back to the cleartext name/type/size already in `folder`
        //    — we never persist them anywhere else.
        const newEncryptedMetadata = encryptMetadata(
          { name: folder.name, type: folder.type, size: folder.size },
          newFolderSessionKey
        );

        // 6. Wrap the new session key to the new folder pub hier.
        const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
          newFolderSessionKey,
          newFolderHier.publicKey,
          keys.encryptionPrivateKey
        );

        // 7. If F itself has a parent, re-wrap F's own parent_keys_claim
        //    using the parent folder's pub hier (unchanged). Pull it
        //    from the cache.
        let folderParentKeysClaim: string | null = null;
        let folderParentKeysClaimWrappedBy: string | null = null;
        if (folder.parentId) {
          const parentEntry = folderPrivHierCache.current.get(folder.parentId);
          if (!parentEntry) {
            // Clean up unwrapped sessionKeys before erroring.
            for (const u of unwrapped) u.sessionKey.fill(0);
            newFolderSessionKey.fill(0);
            return {
              ok: false,
              error: "Parent folder not loaded — open it first, then retry rotation",
            };
          }
          folderParentKeysClaim = wrapParentKeysClaim(
            newFolderSessionKey,
            newFolderHier.privateKey,
            parentEntry.publicHierarchicalKey,
            keys.encryptionPrivateKey
          );
          folderParentKeysClaimWrappedBy = keys.encryptionPublicKey;
        }

        // 8. Re-wrap every direct child's parent_keys_claim under the
        //    NEW folder pub hier. The child's own session key and
        //    priv hier are unchanged — we're just changing the
        //    envelope the pair is stored inside.
        const rewrappedChildren = unwrapped.map((u) => ({
          id: u.id,
          parentKeysClaim: wrapParentKeysClaim(
            u.sessionKey,
            u.childPrivateHierarchicalKey,
            newFolderHier.publicKey,
            keys.encryptionPrivateKey
          ),
          parentKeysClaimWrappedBy: keys.encryptionPublicKey,
        }));

        // 9. Zero every recovered child session key now that we've
        //    re-wrapped them. Child priv hier strings can't be zeroed
        //    (they're base64) — they'll GC with the outer closure.
        for (const u of unwrapped) u.sessionKey.fill(0);

        // 10. Build the new per-user wraps for remaining collaborators.
        const remainingCollaborators = ctx.collaborators
          .filter((c) => c.userId !== revokedUserId)
          .map((c) => ({
            userId: c.userId,
            encryptedPrivateHierarchicalKey: wrapPrivateHierarchicalKeyForUser(
              newFolderHier.privateKey,
              c.publicEncryptionKey,
              keys.encryptionPrivateKey
            ),
            wrappedByPublicKey: keys.encryptionPublicKey,
            permissionLevel: c.permissionLevel,
          }));

        // 11. Commit.
        const commitRes = await fetch(
          `/api/files/${folder.id}/rotate-folder-commit`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              folder: {
                encryptedMetadata: JSON.stringify(newEncryptedMetadata),
                publicHierarchicalKey: newFolderHier.publicKey,
                encryptedSessionKeyByFile,
                sessionKeyNonce,
                parentKeysClaim: folderParentKeysClaim,
                parentKeysClaimWrappedBy: folderParentKeysClaimWrappedBy,
              },
              rewrappedChildren,
              remainingCollaborators,
              revokedUserId,
            }),
          }
        );

        newFolderSessionKey.fill(0);

        const commitData = await commitRes.json();
        if (!commitRes.ok) {
          return {
            ok: false,
            error: commitData.error || "Folder rotation commit failed",
            status: commitRes.status,
          };
        }

        // 12. Refresh the cached folder keys so subsequent navigation
        //     uses the new values without a page reload.
        folderPrivHierCache.current.set(folder.id, {
          publicHierarchicalKey: newFolderHier.publicKey,
          privateHierarchicalKey: newFolderHier.privateKey,
        });
        return { ok: true };
      };

      try {
        let result = await run();
        // Retry once on 409 (concurrent share or new child added
        // between context fetch and commit).
        if (!result.ok && result.status === 409) {
          result = await run();
        }
        if (result.ok) {
          await fetchFiles(state.currentFolder, state.viewMode);
          return { ok: true };
        }
        return { ok: false, error: result.error };
      } catch (err) {
        console.error("rotateAndRevokeFolder", err);
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Folder rotation failed: ${message}` };
      }
    },
    [keys, fetchFiles, state.currentFolder, state.viewMode]
  );

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
        // Remove the file from local state immediately
        setState((s) => ({
          ...s,
          files: s.files.filter((f) => f.id !== fileId),
        }));
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
        await fetchFiles(state.currentFolder, state.viewMode);
        return { ok: true };
      } catch (err) {
        console.error("Permission error:", err);
        return { ok: false, error: "Failed to update" };
      }
    },
    [fetchFiles, state.currentFolder, state.viewMode]
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
      opts?: { expiresAt?: string; password?: string }
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

        // Phase 4.1: if a password is set, wrap the linkKey under a
        // password-derived key and omit it from the URL fragment.
        // Visitors will be prompted for the password on the share page.
        let passwordPayload:
          | { passwordSalt: string; passwordWrappedLinkKey: string; passwordWrapNonce: string }
          | undefined;
        if (opts?.password) {
          passwordPayload = wrapLinkKeyWithPassword(linkKey, opts.password);
        }

        const res = await fetch("/api/files/link/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileId: file.id,
            encryptedPrivateHierarchicalKey,
            linkKeyNonce,
            expiresAt: opts?.expiresAt,
            ...(passwordPayload ?? {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          linkKey.fill(0);
          return { ok: false, error: data.error || "Failed to create link" };
        }

        // Password-protected links use an empty fragment — the password
        // provides the key material, not the URL.
        const fragment = passwordPayload ? "" : encodeLinkKeyForFragment(linkKey);
        linkKey.fill(0);
        const url = passwordPayload
          ? `${window.location.origin}/share/${data.id}`
          : `${window.location.origin}/share/${data.id}#${fragment}`;
        return { ok: true, id: data.id, url };
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
      if (state.activeWorkspace) {
        setState((s) => ({ ...s, currentFolder: state.activeWorkspace!.rootFolderId, callerPermission: null, viewMode: "own", breadcrumb: [{ id: state.activeWorkspace!.rootFolderId, name: state.activeWorkspace!.name }] }));
        await fetchFiles(state.activeWorkspace.rootFolderId, "own");
        return;
      }
      setState((s) => ({ ...s, currentFolder: null, callerPermission: null, viewMode: "own", breadcrumb: [{ id: null, name: "My Drive" }] }));
    } else {
      setState((s) => {
        // Guard against double-click / rapid re-entry producing duplicate
        // breadcrumb entries for the same folder ID — the breadcrumb
        // render keys by crumb.id and duplicates crash React.
        const lastCrumb = s.breadcrumb[s.breadcrumb.length - 1];
        if (lastCrumb?.id === folderId) {
          return { ...s, currentFolder: folderId };
        }
        const isNonOwn = s.viewMode !== "own";
        const rootName =
          s.viewMode === "starred" ? "Starred"
            : s.viewMode === "recent" ? "Recent"
              : s.viewMode === "shared" ? "Shared with me"
                : null;
        return {
          ...s,
          currentFolder: folderId,
          // Keep the view mode so sidebar highlight stays correct.
          // The server fetch always uses "own" for parentId-based
          // queries, but the UI state remembers where we came from.
          breadcrumb:
            isNonOwn && rootName
              ? [{ id: null, name: rootName }, { id: folderId, name: folderName }]
              : [...s.breadcrumb, { id: folderId, name: folderName }],
        };
      });
    }
    await fetchFiles(folderId, "own");
  }, [fetchFiles]);

  /**
   * Switch to a workspace. Sets the workspace root folder as the
   * breadcrumb root so the view is clean (not nested under My Drive).
   * Clicking the breadcrumb root re-fetches the workspace root.
   */
  const navigateToWorkspace = useCallback(async (workspaceId: string, rootFolderId: string, workspaceName: string) => {
    setState((s) => ({
      ...s,
      currentFolder: rootFolderId,
      viewMode: "own",
      activeWorkspace: { id: workspaceId, rootFolderId, name: workspaceName },
      breadcrumb: [{ id: rootFolderId, name: workspaceName }],
    }));
    await fetchFiles(rootFolderId, "own");
  }, [fetchFiles]);

  const leaveWorkspace = useCallback(() => {
    setState((s) => ({
      ...s,
      currentFolder: null,
      callerPermission: null,
      activeWorkspace: null,
      viewMode: "own",
      breadcrumb: [{ id: null, name: "My Drive" }],
    }));
    fetchFiles(null, "own");
  }, [fetchFiles]);

  const navigateToBreadcrumb = useCallback(async (index: number) => {
    setState((s) => ({
      ...s,
      breadcrumb: s.breadcrumb.slice(0, index + 1),
    }));
    const target = state.breadcrumb[index];
    const targetId = target?.id ?? null;
    const rootName = state.breadcrumb[0]?.name;
    const rootMode: ViewMode =
      rootName === "Starred" ? "starred"
        : rootName === "Recent" ? "recent"
          : rootName === "Shared with me" ? "shared"
            : rootName === "Trash" ? "trash"
              : "own";
    if (targetId === null) {
      await fetchFiles(null, rootMode);
    } else {
      await fetchFiles(targetId, "own");
    }
  }, [fetchFiles, state.breadcrumb]);

  /**
   * Switch between "My Drive" and "Shared with me". Resets folder context.
   */
  const setViewMode = useCallback(
    async (mode: ViewMode) => {
      // Set breadcrumb FIRST, then fetch. fetchFiles no longer
      // touches breadcrumb — all navigation state is managed here.
      if (mode === "own" && state.activeWorkspace) {
        setState((s) => ({
          ...s,
          currentFolder: state.activeWorkspace!.rootFolderId,
          viewMode: "own",
          breadcrumb: [{ id: state.activeWorkspace!.rootFolderId, name: state.activeWorkspace!.name }],
        }));
        await fetchFiles(state.activeWorkspace.rootFolderId, "own");
      } else {
        const breadcrumb =
          mode === "starred" ? [{ id: null as string | null, name: "Starred" }]
            : mode === "recent" ? [{ id: null as string | null, name: "Recent" }]
              : mode === "trash" ? [{ id: null as string | null, name: "Trash" }]
                : mode === "shared" ? [{ id: null as string | null, name: "Shared with me" }]
                  : [{ id: null as string | null, name: "My Drive" }];
        setState((s) => ({ ...s, viewMode: mode, currentFolder: null, breadcrumb }));
        await fetchFiles(null, mode);
      }
    },
    [fetchFiles, state.activeWorkspace]
  );

  /**
   * Restore a trashed file or folder. Recursive on the server —
   * restores every descendant marked with the same deleted_at.
   */
  const restoreItem = useCallback(
    async (fileId: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const res = await fetch("/api/files/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId }),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.error || "Restore failed" };
        await fetchFiles(null, state.viewMode);
        return { ok: true };
      } catch {
        return { ok: false, error: "Restore failed" };
      }
    },
    [fetchFiles, state.viewMode]
  );

  /**
   * Permanently delete a single trashed item (and every descendant).
   * Cleans up R2 blobs.
   */
  const purgeItem = useCallback(
    async (fileId: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const res = await fetch("/api/files/purge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId }),
        });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.error || "Purge failed" };
        await fetchFiles(null, state.viewMode);
        return { ok: true };
      } catch {
        return { ok: false, error: "Purge failed" };
      }
    },
    [fetchFiles, state.viewMode]
  );

  /**
   * Empty the trash — hard-delete every trashed item for this user.
   */
  const emptyTrash = useCallback(
    async (): Promise<{ ok: true; purged: number } | { ok: false; error: string }> => {
      try {
        const res = await fetch("/api/files/trash/empty", { method: "POST" });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.error || "Empty trash failed" };
        await fetchFiles(null, "trash");
        return { ok: true, purged: data.purged ?? 0 };
      } catch {
        return { ok: false, error: "Empty trash failed" };
      }
    },
    [fetchFiles]
  );

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  // ── Search index ─────────────────────────────────────────────────
  // Lazily built on first search, cached for the session. Contains
  // every file the user can access with decrypted names.
  const searchIndexRef = useRef<{ id: string; name: string; isFolder: boolean; parentId: string | null }[] | null>(null);
  const searchBuildingRef = useRef(false);

  const searchFiles = useCallback(
    async (query: string): Promise<{ id: string; name: string; isFolder: boolean; parentId: string | null }[]> => {
      if (!keys) return [];

      // Build index on first call
      if (!searchIndexRef.current && !searchBuildingRef.current) {
        searchBuildingRef.current = true;
        try {
          const res = await fetch("/api/files/list?all=true");
          const data = await res.json();
          if (!res.ok) { searchBuildingRef.current = false; return []; }

          const index: { id: string; name: string; isFolder: boolean; parentId: string | null }[] = [];
          for (const f of data.files) {
            const encPrivHier = (f.encrypted_private_hierarchical_key as string) || "";
            if (!encPrivHier) continue;
            try {
              const privHier = unwrapPrivateHierarchicalKey(encPrivHier, f.wrapped_by_public_key || "", keys.encryptionPrivateKey);
              const sk = unwrapSessionKeyFromFile(f.encrypted_session_key_by_file, f.session_key_nonce, f.owner_public_key || "", privHier);
              const encMeta = typeof f.encrypted_metadata === "string" ? JSON.parse(f.encrypted_metadata) : f.encrypted_metadata;
              const meta = decryptMetadata(encMeta, sk);
              sk.fill(0);
              index.push({ id: f.id, name: meta.name, isFolder: f.is_folder, parentId: f.parent_id ?? null });
            } catch {
              // skip undecryptable
            }
          }
          searchIndexRef.current = index;
        } catch {
          searchBuildingRef.current = false;
          return [];
        }
        searchBuildingRef.current = false;
      }

      // Wait for in-progress build
      if (searchBuildingRef.current) {
        await new Promise((r) => setTimeout(r, 500));
        if (!searchIndexRef.current) return [];
      }

      if (!searchIndexRef.current) return [];

      const q = query.toLowerCase().trim();
      if (!q) return searchIndexRef.current.slice(0, 20);
      return searchIndexRef.current.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 50);
    },
    [keys]
  );

  /**
   * Export all owned files as a zip archive. Fetches every file,
   * decrypts each one client-side, builds the zip with folder
   * structure, and triggers a browser download. Server never sees
   * plaintext.
   */
  const exportAllAsZip = useCallback(
    async (onProgress?: (pct: number, step: string) => void): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!keys) return { ok: false, error: "Not signed in" };

      try {
        // 1. Fetch all owned files
        onProgress?.(5, "Fetching file list...");
        const res = await fetch("/api/files/list?all=true");
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.error || "Failed to fetch files" };

        const files = data.files as Record<string, unknown>[];
        if (files.length === 0) return { ok: false, error: "No files to export" };

        // 2. Build folder path map (id → path segments)
        const nameMap = new Map<string, { name: string; parentId: string | null; isFolder: boolean }>();
        for (const f of files) {
          const encPrivHier = (f.encrypted_private_hierarchical_key as string) || "";
          if (!encPrivHier) continue;
          try {
            const privHier = unwrapPrivateHierarchicalKey(encPrivHier, (f.wrapped_by_public_key as string) || "", keys.encryptionPrivateKey);
            const sk = unwrapSessionKeyFromFile(f.encrypted_session_key_by_file as string, f.session_key_nonce as string, (f.owner_public_key as string) || "", privHier);
            const encMeta = typeof f.encrypted_metadata === "string" ? JSON.parse(f.encrypted_metadata as string) : f.encrypted_metadata;
            const meta = decryptMetadata(encMeta as { nonce: string; ciphertext: string }, sk);
            sk.fill(0);
            nameMap.set(f.id as string, { name: meta.name, parentId: (f.parent_id as string | null) ?? null, isFolder: f.is_folder as boolean });
          } catch {
            // skip undecryptable
          }
        }

        const getPath = (id: string): string => {
          const parts: string[] = [];
          let current = id;
          const maxDepth = 64;
          for (let d = 0; d < maxDepth; d++) {
            const entry = nameMap.get(current);
            if (!entry) break;
            parts.unshift(entry.name);
            if (!entry.parentId) break;
            current = entry.parentId;
          }
          return parts.join("/");
        };

        // 3. Decrypt + collect file contents
        const { zipSync } = await import("fflate");
        const zipData: Record<string, Uint8Array> = {};
        const nonFolders = files.filter((f) => !(f.is_folder as boolean) && nameMap.has(f.id as string));
        let done = 0;

        for (const f of nonFolders) {
          const fileId = f.id as string;
          const path = getPath(fileId);
          onProgress?.(5 + Math.round((done / nonFolders.length) * 85), `Decrypting ${path}...`);

          try {
            const dlRes = await fetch(`/api/files/chunk-download?fileId=${fileId}`);
            const dlData = await dlRes.json();
            if (!dlRes.ok || dlData.noContent) { done++; continue; }

            const sessionKey = unwrapSessionKeyFromDownload(dlData);

            let content: Uint8Array;
            if (dlData.chunked) {
              const chunks = dlData.chunks as { sequence: number; downloadUrl: string; encryptionNonce: string; isFinal: boolean }[];
              const decryptedChunks: Uint8Array[] = [];
              for (const chunk of chunks) {
                const r2 = await fetch(chunk.downloadUrl);
                const encrypted = new Uint8Array(await r2.arrayBuffer());
                decryptedChunks.push(decryptChunk(encrypted, chunk.encryptionNonce, chunk.sequence, chunk.isFinal, sessionKey));
              }
              const total = decryptedChunks.reduce((s, c) => s + c.length, 0);
              content = new Uint8Array(total);
              let offset = 0;
              for (const c of decryptedChunks) { content.set(c, offset); offset += c.length; }
            } else {
              const r2 = await fetch(dlData.downloadUrl);
              const encrypted = new Uint8Array(await r2.arrayBuffer());
              content = decryptFileContent(encrypted, dlData.encryptionNonce, sessionKey);
            }
            sessionKey.fill(0);
            zipData[path] = content;
          } catch {
            // skip failed files
          }
          done++;
        }

        if (Object.keys(zipData).length === 0) {
          return { ok: false, error: "No files could be decrypted" };
        }

        // 4. Build zip and download
        onProgress?.(92, "Building zip...");
        const zipped = zipSync(zipData);
        const blob = new Blob([new Uint8Array(zipped)], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `securewarp-export-${new Date().toISOString().slice(0, 10)}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        onProgress?.(100, "Done");
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Export failed";
        return { ok: false, error: message };
      }
    },
    [keys, unwrapSessionKeyFromDownload]
  );

  return {
    ...state,
    initialized,
    fetchFiles,
    uploadFile,
    downloadFile,
    previewFile,
    createFolder,
    renameFile,
    moveFile,
    toggleStar,
    deleteItem,
    restoreItem,
    purgeItem,
    emptyTrash,
    shareFile,
    unshareFile,
    leaveShare,
    rotateAndRevoke,
    rotateAndRevokeFolder,
    setPermission,
    createLink,
    revokeLink,
    listLinks,
    loadCollaborators,
    setViewMode,
    navigateToFolder,
    navigateToWorkspace,
    leaveWorkspace,
    navigateToBreadcrumb,
    clearError,
    searchFiles,
    exportAllAsZip,
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
