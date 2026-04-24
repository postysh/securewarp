"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from "react";
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
  type HybridPublicKeys,
  type HybridPrivateKeys,
} from "@/lib/crypto/file-crypto";
import {
  getChunkCount,
  CHUNK_SIZE,
  CONCURRENT_CHUNK_UPLOADS,
} from "@/lib/crypto/chunked-encryption";
import { getChunkPool } from "@/lib/crypto/chunk-pool";
import { toBase64, fromBase64 } from "@/lib/crypto/utils";
import { friendlyError } from "@/lib/ui/errors";
import { safeMimeForBlob, safeMimeForDownload } from "@/lib/mime-safety";
import { putChunkWithRetry } from "@/lib/net/chunk-upload";
import { openDownloadSink, DownloadCancelled } from "@/lib/net/download-sink";
import { createPreviewCache } from "@/lib/cache/preview-cache";
import {
  loadAll as loadSearchCache,
  replaceAll as replaceSearchCache,
  upsertOne as upsertSearchCache,
  deleteOne as deleteSearchCache,
  getBuiltAt as getSearchBuiltAt,
  markBuilt as markSearchBuilt,
  clearFor as clearSearchCache,
  type SearchCacheEntry,
} from "@/lib/search/local-cache";
import {
  create as createOrama,
  insert as insertOrama,
  insertMultiple as insertMultipleOrama,
  remove as removeOrama,
  search as searchOrama,
  type AnyOrama,
} from "@orama/orama";

export interface FileCollaboratorPreview {
  userId: string;
  email: string;
  displayName?: string | null;
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
  ownerEmail: string | null;
  ownerDisplayName?: string | null;
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
  // Crypto v2 Phase 2b — file's hybrid pub hier keys (X25519 +
  // ML-KEM-768) and owner's ML-KEM pub, needed for the hybrid
  // session-key unwrap.
  ownerPublicKemKey: string;
  publicHierarchicalKey: string;
  publicKemHierarchicalKey: string;
  encryptedSessionKeyByFile: string;
  sessionKeyNonce: string;
  // Phase 3 parent_keys_claim. Non-null for any file with a parent.
  parentKeysClaim: string | null;
  parentKeysClaimWrappedBy: string | null;
  // Workspace membership — null for personal-drive files. Used by
  // the Share modal to pull link-policy (disable/require-password/
  // max-expiry) when a workspace admin has set a posture.
  workspaceId: string | null;
  isStarred: boolean;
  // True when at least one non-revoked, non-expired public link exists
  // for this file. Surfaced as a "Public" pill in the Shared column so
  // the owner can tell at a glance which files are reachable without
  // an account.
  hasActiveLink: boolean;
  // Trust & safety: when non-null, the file is frozen by admins. The
  // owner's drive renders an "under review" badge and disables
  // delete/trash/rename. Cleared only via an admin action.
  evidenceHoldAt: string | null;
  // Server-side NEW-badge dismissal. ISO timestamp of when this user
  // first acknowledged the file, or null if they haven't yet. Lets
  // the badge stay dismissed across browsers and devices.
  seenAt: string | null;
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
  displayName?: string | null;
  publicEncryptionKey: string;
  isOwner: boolean;
  permissionLevel: PermissionLevel | "owner";
}

/**
 * A single upload's position in the floating-panel queue. Lives in
 * hook state so the panel survives folder navigation (the file row
 * placeholder, on the other hand, is scoped to the current folder's
 * list and disappears when you navigate away).
 */
export interface UploadRecord {
  id: string; // uuid unique per upload
  name: string; // plaintext filename, client-side only
  size: number;
  progress: number; // 0-100
  status: "uploading" | "done" | "error";
  kind: "new" | "version"; // new upload vs. new version of existing
  error?: string;
  startedAt: number;
  fileId?: string; // set after init; lets user click to reveal
}

/**
 * Download counterpart to UploadRecord. Powers the floating
 * download-panel tray in the bottom-right corner — same pattern as
 * uploads, except progress advances per chunk decrypted rather than
 * per byte uploaded. Single-chunk files jump straight from 5% →
 * 100% so the row flashes briefly; the 500ms min-display in the
 * panel component keeps it from looking janky.
 */
export interface DownloadRecord {
  id: string;
  fileId: string;
  name: string;
  size: number;
  progress: number;
  status: "downloading" | "done" | "error";
  error?: string;
  startedAt: number;
}

interface UseFilesState {
  files: DecryptedFile[];
  loading: boolean;
  uploading: boolean;
  uploadStep: string | null;
  uploadProgress: number;
  uploadQueue: UploadRecord[];
  downloadQueue: DownloadRecord[];
  error: string | null;
  currentFolder: string | null;
  breadcrumb: { id: string | null; name: string }[];
  viewMode: ViewMode;
  callerPermission: string | null;
  // Active workspace context. When set, "My Drive" means the
  // workspace root, not the personal root.
  activeWorkspace: { id: string; rootFolderId: string; name: string; role: string } | null;
  nextCursor: string | null;
}

/**
 * Hook for encrypted file operations.
 * Requires the user's decrypted keys to be passed in.
 */
export function useFiles(keys: {
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
  kemPublicKey: string;
  kemPrivateKey: string;
  email: string;
} | null) {
  const [state, setState] = useState<UseFilesState>(() => {
    // Seed from sessionStorage so the very first render matches the
    // user's last view — avoids a flicker from "My Drive" → target
    // on every page refresh. The file-browser mount effect still
    // fires fetchFiles against the same coordinates to populate the
    // file list; what we're avoiding here is the intermediate frame
    // where the sidebar highlight + breadcrumb were briefly wrong.
    const defaults: UseFilesState = {
      files: [],
      loading: false,
      uploading: false,
      uploadStep: null,
      uploadProgress: 0,
      uploadQueue: [],
      downloadQueue: [],
      error: null,
      currentFolder: null,
      callerPermission: null,
      activeWorkspace: null,
      nextCursor: null,
      breadcrumb: [{ id: null, name: "My Drive" }],
      viewMode: "own",
    };
    if (typeof window === "undefined") return defaults;
    try {
      const wsRaw = sessionStorage.getItem("securewarp_active_workspace");
      const vRaw = sessionStorage.getItem("securewarp_view_state");
      const savedWs = wsRaw ? JSON.parse(wsRaw) : null;
      const savedView = vRaw ? JSON.parse(vRaw) : null;
      if (savedWs) {
        defaults.activeWorkspace = {
          id: savedWs.id,
          rootFolderId: savedWs.rootFolderId,
          name: savedWs.name,
          role: savedWs.role || "editor",
        };
        defaults.breadcrumb = [{ id: savedWs.rootFolderId, name: savedWs.name }];
        defaults.currentFolder = savedWs.rootFolderId;
        if (
          savedView?.currentFolder &&
          savedView.currentFolder !== savedWs.rootFolderId &&
          Array.isArray(savedView.breadcrumb) &&
          savedView.breadcrumb.length > 0
        ) {
          defaults.currentFolder = savedView.currentFolder;
          defaults.breadcrumb = savedView.breadcrumb;
        }
      } else if (savedView?.viewMode) {
        defaults.viewMode = savedView.viewMode;
        defaults.currentFolder = savedView.currentFolder ?? null;
        if (Array.isArray(savedView.breadcrumb) && savedView.breadcrumb.length > 0) {
          defaults.breadcrumb = savedView.breadcrumb;
        }
      }
    } catch { /* quota / private mode — fall back to defaults */ }
    return defaults;
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
  // LRU cache for folder hierarchical keys. Bounded to 128 entries
  // to prevent unbounded memory growth for users with hundreds of
  // folders. Evicts least-recently-used entries automatically.
  // Crypto v2 Phase 2b — cache holds hybrid pub + priv hier bundles
  // per folder. The X25519 + ML-KEM split means both halves must
  // survive in memory; serializing or dropping one would break the
  // hybrid wrap/unwrap invariant.
  const folderPrivHierCache = useRef((() => {
    const MAX = 128;
    type Entry = {
      publicHierarchicalKey: string;
      publicKemHierarchicalKey: string;
      privateHierarchicalKeys: HybridPrivateKeys;
    };
    const map = new Map<string, Entry>();
    return {
      get(key: string) {
        const val = map.get(key);
        if (val) { map.delete(key); map.set(key, val); } // move to end (most recent)
        return val;
      },
      set(key: string, val: Entry) {
        map.delete(key);
        map.set(key, val);
        if (map.size > MAX) { const first = map.keys().next().value; if (first) map.delete(first); }
      },
      has(key: string) { return map.has(key); },
      clear() { map.clear(); },
      get current() { return this; },
    };
  })());

  // File list cache — stale-while-revalidate. Keyed by
  // `${mode}:${parentId}`. Shows cached data instantly on navigation,
  // refreshes in background. Cleared on key change (login swap).
  const fileListCache = useRef<Map<string, DecryptedFile[]>>(new Map());

  // Preview cache — stores decrypted Blobs so re-opening the same
  // file doesn't re-fetch + re-decrypt every time. Cleared on key
  // change / unmount (covered by the effect below) and invalidated
  // per-file on new version / rotate / restore / delete.
  const previewCache = useRef(createPreviewCache());

  // Dedup concurrent preview requests for the same fileId. When a
  // user opens a large file, closes the preview mid-decrypt, and
  // reopens it, the second open must NOT spawn a second pipeline —
  // two concurrent decrypts racing on the same onProgress setter
  // made the loading % jump around (50 → 3 → 51 → 4…), and doubled
  // the network + CPU work. Joiners snap their onProgress to the
  // current % and take over the live update channel so the stranded
  // first caller's callback is never invoked again. Slot is removed
  // in the pipeline's `finally`. Wiped on key change below.
  type PreviewResult =
    | { ok: true; blobUrl: string; name: string; type: string }
    | { ok: false; error: string };
  const previewInflight = useRef(
    new Map<
      string,
      {
        promise: Promise<PreviewResult>;
        notify: (pct: number) => void;
        lastPct: number;
      }
    >(),
  );

  // Per-file upload cap for the current plan. Lazy-fetched on the first
  // upload so the dashboard render path doesn't pay a round-trip. The
  // server enforces authoritatively — this is a UX nicety so the user
  // gets an instant plan-aware error instead of waiting for the init
  // round-trip to fail with 413. Invalidated when billing changes.
  const planCapsRef = useRef<{ maxFileSizeBytes: number; tierLabel: string } | null>(null);
  useEffect(() => {
    const clear = () => { planCapsRef.current = null; };
    window.addEventListener("securewarp-billing-refresh", clear);
    return () => window.removeEventListener("securewarp-billing-refresh", clear);
  }, []);
  const getPlanCaps = async (): Promise<{ maxFileSizeBytes: number; tierLabel: string } | null> => {
    if (planCapsRef.current) return planCapsRef.current;
    try {
      const res = await fetch("/api/files/usage");
      if (!res.ok) return null;
      const data = await res.json();
      if (typeof data.maxFileSizeBytes !== "number") return null;
      planCapsRef.current = {
        maxFileSizeBytes: data.maxFileSizeBytes,
        tierLabel: data.tierLabel ?? "your",
      };
      return planCapsRef.current;
    } catch {
      return null;
    }
  };
  const formatCap = (bytes: number): string => {
    const GB = 1024 * 1024 * 1024;
    const MB = 1024 * 1024;
    if (bytes >= GB) {
      const val = bytes / GB;
      return `${Number.isInteger(val) ? val : val.toFixed(1)} GB`;
    }
    return `${Math.round(bytes / MB)} MB`;
  };

  // In-memory mirror of the decrypted search-cache entries. Populated
  // once after the IndexedDB cache is built or rehydrated; kept in
  // sync with upload/rename/delete mutations. Searches query this
  // ref SYNCHRONOUSLY — no async IndexedDB read per keystroke, no
  // flicker between debounce firing and results resolving.
  const searchEntriesRef = useRef<SearchCacheEntry[] | null>(null);
  // Tracks when the cache was last rebuilt. Used by
  // refreshSearchCacheIfStale to decide whether to force a rebuild
  // when Command Palette opens.
  const lastBuildMsRef = useRef<number | null>(null);
  // Orama full-text index — mirrors searchEntriesRef, gives us
  // typo-tolerant BM25-ranked search instead of the old
  // substring-scoring path. Built from the mirror on rebuild/hydrate
  // and kept in sync on per-item mutations via the helpers below.
  const oramaDbRef = useRef<AnyOrama | null>(null);
  const buildOramaIndex = async (entries: SearchCacheEntry[]): Promise<AnyOrama> => {
    const db = await createOrama({
      schema: { name: "string", breadcrumb: "string" },
    });
    if (entries.length > 0) {
      await insertMultipleOrama(
        db,
        entries.map((e) => ({ id: e.id, name: e.name, breadcrumb: e.breadcrumb })),
      );
    }
    return db;
  };
  // Tiny helper so each mutation site is one line instead of four.
  const syncSearchMirror = (entry: SearchCacheEntry) => {
    const current = searchEntriesRef.current;
    if (current) {
      const idx = current.findIndex((e) => e.id === entry.id);
      if (idx >= 0) current[idx] = entry;
      else current.push(entry);
    }
    const db = oramaDbRef.current;
    if (db) {
      // Fire-and-forget: Orama's in-memory ops resolve in a single
      // microtask. A failure here just means the entry is absent from
      // the index until the next cache rebuild — not catastrophic.
      void (async () => {
        try { await removeOrama(db, entry.id); } catch { /* not present yet */ }
        try {
          await insertOrama(db, { id: entry.id, name: entry.name, breadcrumb: entry.breadcrumb });
        } catch { /* best-effort */ }
      })();
    }
  };
  const removeFromSearchMirror = (fileId: string) => {
    const current = searchEntriesRef.current;
    if (current) {
      const idx = current.findIndex((e) => e.id === fileId);
      if (idx >= 0) current.splice(idx, 1);
    }
    const db = oramaDbRef.current;
    if (db) {
      void (async () => {
        try { await removeOrama(db, fileId); } catch { /* */ }
      })();
    }
  };

  useEffect(() => {
    // Wipe on key change (which covers logout → login swap) and on
    // unmount. Plaintext private hierarchical keys and plaintext
    // preview Blobs live here and must not outlive the session they
    // were decrypted in.
    folderPrivHierCache.current.clear();
    fileListCache.current.clear();
    previewCache.current.clear();
    previewInflight.current.clear();
    return () => {
      folderPrivHierCache.current.clear();
      fileListCache.current.clear();
      previewCache.current.clear();
      previewInflight.current.clear();
    };
  }, [keys]);

  /** Clear file list cache — call before any mutation refetch */
  const invalidateCache = useCallback(() => {
    fileListCache.current.clear();
  }, []);

  /**
   * Resolve a folder's priv hier keys for use as a parent in
   * wrap/unwrap operations (parent_keys_claim re-wrap on move,
   * claim generation on upload into folder, etc.).
   *
   * Handles BOTH access paths — direct file_keys row OR inherited
   * via parent_keys_claim chain. Before this helper existed, each
   * call site inlined the direct-only logic and would return null
   * for inherited-access viewers, causing files to move into
   * folders without a valid claim and show "[Encrypted]" for
   * other members.
   *
   * Populates folderPrivHierCache on success so subsequent calls
   * for the same folder skip the network round-trip.
   */
  const resolveFolderPrivHierById = useCallback(
    async (
      folderId: string,
    ): Promise<{
      publicHierarchicalKey: string;
      publicKemHierarchicalKey: string;
      privateHierarchicalKeys: HybridPrivateKeys;
    } | null> => {
      if (!keys) return null;
      const cached = folderPrivHierCache.current.get(folderId);
      if (cached) return cached;

      try {
        const res = await fetch(`/api/files/chunk-download?fileId=${folderId}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.publicHierarchicalKey || !data.publicKemHierarchicalKey) return null;

        let privHier: HybridPrivateKeys | null = null;
        if (data.encryptedPrivateHierarchicalKey && data.wrappedByPublicKey) {
          privHier = unwrapPrivateHierarchicalKey(
            data.encryptedPrivateHierarchicalKey,
            data.wrappedByPublicKey,
            keys.encryptionPrivateKey,
            keys.kemPrivateKey,
          );
        } else if (data.ancestorKey && data.parentChain?.length) {
          let current: HybridPrivateKeys = unwrapPrivateHierarchicalKey(
            data.ancestorKey.encrypted_private_hierarchical_key,
            data.ancestorKey.wrapped_by_public_key,
            keys.encryptionPrivateKey,
            keys.kemPrivateKey,
          );
          // Walk chain ancestor→file (reverse order); see the
          // matching comment in unwrapSessionKeyFromDownload.
          const chain = data.parentChain as Array<{
            parentKeysClaim: string;
            parentKeysClaimWrappedBy: string;
          }>;
          for (let i = chain.length - 1; i >= 0; i--) {
            const link = chain[i];
            const unwrapped = unwrapParentKeysClaim(
              link.parentKeysClaim,
              link.parentKeysClaimWrappedBy,
              current,
            );
            current = unwrapped.childPrivateHierarchicalKeys;
            unwrapped.sessionKey.fill(0);
          }
          privHier = current;
        }
        if (!privHier) return null;

        const entry = {
          publicHierarchicalKey: data.publicHierarchicalKey as string,
          publicKemHierarchicalKey: data.publicKemHierarchicalKey as string,
          privateHierarchicalKeys: privHier,
        };
        folderPrivHierCache.current.set(folderId, entry);
        return entry;
      } catch {
        return null;
      }
    },
    [keys],
  );

  // Scrub a deleted label id off every file's `fileLabels` in state
  // and invalidate the cache so the next fetch doesn't re-surface
  // stale rows from the list cache. Dispatched by the sidebar when
  // a label is deleted — without this, the coloured dot lingers on
  // every previously-tagged file/folder until the page is reloaded.
  useEffect(() => {
    const onDeleted = (e: Event) => {
      const labelId = (e as CustomEvent<{ labelId: string }>).detail?.labelId;
      if (!labelId) return;
      fileListCache.current.clear();
      setState((s) => ({
        ...s,
        files: s.files.map((f) =>
          f.fileLabels.some((l) => l.id === labelId)
            ? { ...f, fileLabels: f.fileLabels.filter((l) => l.id !== labelId) }
            : f,
        ),
      }));
    };
    window.addEventListener("securewarp-label-deleted", onDeleted);
    return () => window.removeEventListener("securewarp-label-deleted", onDeleted);
  }, []);

  /** Prefetch a folder's contents in the background (hover intent).
   *  Runs the full fetch + decrypt + cache pipeline silently. When the
   *  user clicks, the stale-while-revalidate shows cached data instantly. */
  const prefetchingRef = useRef<Set<string>>(new Set());
  const prefetchFolder = useCallback(
    async (folderId: string) => {
      const cacheKey = `own:${folderId}`;
      if (fileListCache.current.has(cacheKey)) return;
      if (prefetchingRef.current.has(cacheKey)) return;
      if (!keys) return;
      prefetchingRef.current.add(cacheKey);
      try {
        const res = await fetch(`/api/files/list?parentId=${folderId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.files) return;

        const sorted = [...data.files].sort(
          (a: Record<string, unknown>, b: Record<string, unknown>) =>
            (b.is_folder ? 1 : 0) - (a.is_folder ? 1 : 0)
        );
        const results: DecryptedFile[] = [];
        for (const f of sorted) {
          const encPrivHier = (f.encrypted_private_hierarchical_key as string) || "";
          if (!encPrivHier) continue;
          try {
            const privHier = unwrapPrivateHierarchicalKey(
              encPrivHier,
              (f.wrapped_by_public_key as string) || "",
              keys.encryptionPrivateKey,
              keys.kemPrivateKey,
            );
            const sk = unwrapSessionKeyFromFile(
              f.encrypted_session_key_by_file as string,
              (f.session_key_nonce as string) ?? "",
              (f.owner_public_key as string) || "",
              privHier,
            );
            const encMeta = typeof f.encrypted_metadata === "string" ? JSON.parse(f.encrypted_metadata as string) : f.encrypted_metadata;
            const meta = decryptMetadata(encMeta, sk);
            sk.fill(0);
            if ((f.is_folder as boolean) && f.public_hierarchical_key && f.public_kem_hierarchical_key) {
              folderPrivHierCache.current.set(f.id as string, {
                publicHierarchicalKey: f.public_hierarchical_key as string,
                publicKemHierarchicalKey: f.public_kem_hierarchical_key as string,
                privateHierarchicalKeys: privHier,
              });
            }
            results.push({
              id: f.id as string, isFolder: f.is_folder as boolean, parentId: (f.parent_id as string | null) ?? null,
              ownerId: (f.owner_id as string) || "", ownerEmail: (f.owner_email as string | null) ?? null, ownerDisplayName: (f.owner_display_name as string | null) ?? null, createdAt: f.created_at as string, updatedAt: f.updated_at as string,
              encryptedPrivateHierarchicalKey: encPrivHier, wrappedByPublicKey: (f.wrapped_by_public_key as string) || "",
              ownerPublicKey: (f.owner_public_key as string) || "",
              ownerPublicKemKey: (f.owner_public_kem_key as string) || "",
              publicHierarchicalKey: (f.public_hierarchical_key as string) || "",
              publicKemHierarchicalKey: (f.public_kem_hierarchical_key as string) || "",
              encryptedSessionKeyByFile: f.encrypted_session_key_by_file as string, sessionKeyNonce: (f.session_key_nonce as string) ?? "",
              parentKeysClaim: (f.parent_keys_claim as string | null) ?? null, parentKeysClaimWrappedBy: (f.parent_keys_claim_wrapped_by as string | null) ?? null,
              isStarred: !!(f.is_starred), hasActiveLink: !!(f.has_active_link), evidenceHoldAt: (f.evidence_hold_at as string | null) ?? null, seenAt: (f.seen_at as string | null) ?? null, fileLabels: (f.file_labels as { id: string; name: string; color: string }[] | undefined) ?? [],
              isShared: false, collaborators: (f.collaborators as FileListCollabShape[] | undefined) ?? [],
              name: meta.name, type: meta.type, size: meta.size,
            } as DecryptedFile);
          } catch { /* skip */ }
        }
        fileListCache.current.set(cacheKey, results);
      } catch { /* silent */ } finally {
        prefetchingRef.current.delete(cacheKey);
      }
    },
    [keys]
  );

  // Sequence counter for fetchFiles. Ensures that when a user clicks
  // Recent → My Drive in quick succession, the slower Recent response
  // can't arrive after the My Drive response and overwrite the view.
  // Any setState that commits the *result* of a fetch is gated on
  // `mySeq === fetchFilesSeqRef.current`; the optimistic pre-fetch
  // setState still fires unconditionally so the sidebar flips
  // immediately.
  const fetchFilesSeqRef = useRef(0);

  const fetchFiles = useCallback(
    async (parentId: string | null = null, mode: ViewMode = "own", breadcrumbOverride?: { id: string | null; name: string }[], viewModeOverride?: ViewMode, opts?: { silent?: boolean }) => {
      if (!keys) return;
      const mySeq = ++fetchFilesSeqRef.current;
      const cacheKey = `${mode}:${parentId ?? "root"}`;
      const cached = fileListCache.current.get(cacheKey);
      const silent = !!opts?.silent;

      // Foreground fetches (nav, mount) optimistically update view
      // coordinates + may flip `loading: true` on a cache miss so the
      // skeleton can render while the network call is in flight.
      //
      // Silent fetches (background polling) MUST leave loading, files,
      // currentFolder, viewMode, and breadcrumb untouched at call time
      // — any of those changing would flicker the skeleton on an
      // empty folder or briefly blank the row on a stale cache key.
      // Silent fetches only write to state AFTER the network response
      // arrives, replacing `files` in place.
      if (!silent) {
        // Detect whether this is a view-switch vs a refresh. When the
        // viewMode is changing, we MUST clear `files` — otherwise the
        // previous view's data keeps rendering while the network fetch
        // is in flight, and the client-side sort re-orders those
        // stale rows under the new view's saved sort preference (the
        // Recent → Starred flicker). Cached hits skip this because
        // they replace `files` with the correct view's data instantly.
        const nextViewMode =
          viewModeOverride ?? (mode === "own" && parentId ? undefined : mode);
        const viewChanging =
          nextViewMode !== undefined && nextViewMode !== state.viewMode;
        setState((s) => ({
          ...s,
          ...(cached
            ? { files: cached, loading: false }
            : viewChanging
              ? { files: [], loading: true }
              : { loading: s.loading || !initialized || s.files.length === 0 }),
          error: null,
          currentFolder: mode !== "own" ? null : parentId,
          viewMode: viewModeOverride ?? (mode === "own" && parentId ? s.viewMode : mode),
          ...(breadcrumbOverride ? { breadcrumb: breadcrumbOverride } : {}),
        }));
        setInitialized(true);
      }

      try {
        const url =
          mode === "starred"
            ? "/api/files/list?starred=true"
            : mode === "recent"
              ? "/api/files/list?recent=true"
              : mode === "trash"
                ? `/api/files/list?trash=true${state.activeWorkspace ? `&workspaceId=${state.activeWorkspace.id}` : ""}`
                : mode === "shared"
                  ? "/api/files/list?shared=true"
                  : parentId
                    ? `/api/files/list?parentId=${parentId}`
                    : "/api/files/list";
        const res = await fetch(url);
        const data = await res.json();

        // Drop stale responses — a newer fetchFiles call has already
        // started, so its view is authoritative. Prevents the
        // Recent→My-Drive quick-click flicker.
        if (mySeq !== fetchFilesSeqRef.current) return;

        if (!res.ok) {
          setState((s) => ({ ...s, loading: false, error: data.error }));
          return;
        }

        // Sort folders before files so parent hier keys are cached
        // before any inherited child tries to walk the parent chain.
        // The normal getFilesForUser query does this via ORDER BY
        // is_folder DESC, but starred/recent/trash views order by
        // different columns. We ONLY reorder for the decrypt loop —
        // the final `results` array is re-sorted back into server
        // order below so flat views (Recent/Starred/Shared/Trash)
        // aren't mangled by folders-first rearrangement. Recent in
        // particular returns a mix of files and folders by
        // accessed_at desc, and the old folders-first client sort
        // caused renamed files to sink below any folder in the list.
        const originalPosition = new Map<string, number>();
        (data.files as Record<string, unknown>[]).forEach((f, i) => {
          originalPosition.set(f.id as string, i);
        });
        const sorted = [...data.files].sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
          (b.is_folder ? 1 : 0) - (a.is_folder ? 1 : 0)
        );

        // Off-thread decrypt fast path. The expensive work per row
        // — unwrapPrivateHierarchicalKey + unwrapSessionKeyFromFile
        // + decryptMetadata — happens in a Web Worker so the main
        // thread can keep painting the skeleton + responding to
        // input. Only direct-access rows qualify (files the caller
        // has their own file_keys row on); inherited rows that
        // need a parent_keys_claim walk stay on the main thread
        // because the walk does async fetches for intermediate
        // parents. Worker returns are structured-cloned back — the
        // HybridPrivateKeys blob survives the postMessage boundary
        // and lands directly in folderPrivHierCache.
        //
        // On worker failure (import error, crash, etc.) the whole
        // batch is skipped and tryDecrypt below handles every row
        // on the main thread — same behavior as before this fast
        // path existed.
        const workerMetas = new Map<
          string,
          {
            name: string;
            type: string;
            size: number;
            privHier?: HybridPrivateKeys;
            publicHierarchicalKey?: string;
            publicKemHierarchicalKey?: string;
            isFolder: boolean;
          }
        >();
        {
          const directRows = sorted
            .filter((f: Record<string, unknown>) => !!(f.encrypted_private_hierarchical_key as string | null))
            .map((f: Record<string, unknown>) => ({
              fileId: f.id as string,
              encryptedPrivHier: (f.encrypted_private_hierarchical_key as string) || "",
              wrappedByPublicKey: (f.wrapped_by_public_key as string) || "",
              ownerPublicKey: (f.owner_public_key as string) || "",
              encSessionKeyByFile: (f.encrypted_session_key_by_file as string) || "",
              sessionKeyNonce: (f.session_key_nonce as string) || "",
              encryptedMetadata:
                typeof f.encrypted_metadata === "string"
                  ? (f.encrypted_metadata as string)
                  : JSON.stringify(f.encrypted_metadata),
              publicHierarchicalKey: (f.public_hierarchical_key as string) || "",
              publicKemHierarchicalKey: (f.public_kem_hierarchical_key as string) || "",
              isFolder: f.is_folder as boolean,
            }));
          if (directRows.length > 0) {
            try {
              const { decryptMetadataBatch } = await import("@/lib/crypto/metadata-decrypt");
              const workPromise = decryptMetadataBatch({
                files: directRows,
                encryptionPrivateKey: keys.encryptionPrivateKey,
                kemPrivateKey: keys.kemPrivateKey,
              });
              if (workPromise) {
                const workerResults = await workPromise;
                for (const r of workerResults) {
                  workerMetas.set(r.fileId, {
                    name: r.name,
                    type: r.type,
                    size: r.size,
                    privHier: r.privHier,
                    publicHierarchicalKey: r.publicHierarchicalKey,
                    publicKemHierarchicalKey: r.publicKemHierarchicalKey,
                    isFolder: r.isFolder,
                  });
                  // Pre-populate the folder priv-hier cache so the
                  // tryDecrypt loop below can unwrap any inherited
                  // child that points at this folder as its parent.
                  if (r.isFolder && r.privHier && r.publicHierarchicalKey && r.publicKemHierarchicalKey) {
                    folderPrivHierCache.current.set(r.fileId, {
                      publicHierarchicalKey: r.publicHierarchicalKey,
                      publicKemHierarchicalKey: r.publicKemHierarchicalKey,
                      privateHierarchicalKeys: r.privHier,
                    });
                  }
                }
              }
            } catch {
              // Worker failed — fall through. tryDecrypt will run
              // the full decrypt chain on the main thread for these
              // rows, same as before this optimization.
            }
          }
        }

        // Drop stale responses again AFTER the worker round-trip.
        // The decrypt batch is fast but not instantaneous; a newer
        // fetch could have started in the meantime and its view is
        // the authoritative one. Without this second check we'd
        // land the previous batch's decoded files on top of the
        // newer view's state.
        if (mySeq !== fetchFilesSeqRef.current) return;

        // Decrypt helper — extracted so we can retry on the second pass.
        // Fast path: if the off-thread worker already decrypted this
        // row (direct-access only), reuse its metadata and skip the
        // whole unwrap chain. Worker also populated folderPrivHierCache
        // for folders, so inherited children below can walk the chain
        // without us doing anything extra here.
        const tryDecrypt = (f: Record<string, unknown>): DecryptedFile | null => {
          const encryptedPrivHier = (f.encrypted_private_hierarchical_key as string) || "";
          const wrappedByPublicKey = (f.wrapped_by_public_key as string) || "";
          const ownerPublicKey = (f.owner_public_key as string) || "";
          const ownerPublicKemKey = (f.owner_public_kem_key as string) || "";
          const publicHierarchicalKey = (f.public_hierarchical_key as string) || "";
          const publicKemHierarchicalKey = (f.public_kem_hierarchical_key as string) || "";
          const encryptedSessionKeyByFile = (f.encrypted_session_key_by_file as string) || "";
          const sessionKeyNonce = (f.session_key_nonce as string) || "";
          const parentKeysClaim = (f.parent_keys_claim as string | null) ?? null;
          const parentKeysClaimWrappedBy = (f.parent_keys_claim_wrapped_by as string | null) ?? null;
          const rowParentId = (f.parent_id as string | null) ?? null;
          const isFolder = f.is_folder as boolean;

          const workerMeta = workerMetas.get(f.id as string);
          if (workerMeta) {
            return {
              id: f.id as string,
              isFolder,
              parentId: rowParentId,
              ownerId: (f.owner_id as string) || "",
              ownerEmail: (f.owner_email as string | null) ?? null,
              ownerDisplayName: (f.owner_display_name as string | null) ?? null,
              createdAt: f.created_at as string,
              updatedAt: f.updated_at as string,
              encryptedPrivateHierarchicalKey: encryptedPrivHier,
              wrappedByPublicKey,
              ownerPublicKey,
              ownerPublicKemKey,
              publicHierarchicalKey,
              publicKemHierarchicalKey,
              encryptedSessionKeyByFile,
              sessionKeyNonce,
              parentKeysClaim,
              parentKeysClaimWrappedBy,
              workspaceId: (f.workspace_id as string | null) ?? null,
              isStarred: !!(f.is_starred),
              hasActiveLink: !!(f.has_active_link),
              evidenceHoldAt: (f.evidence_hold_at as string | null) ?? null,
              seenAt: (f.seen_at as string | null) ?? null,
              fileLabels: (f.file_labels as { id: string; name: string; color: string }[] | undefined) ?? [],
              isShared: mode === "shared",
              collaborators: (f.collaborators as FileListCollabShape[] | undefined) ?? [],
              name: workerMeta.name,
              type: workerMeta.type,
              size: workerMeta.size,
            } as DecryptedFile;
          }

          let sessionKey: Uint8Array;
          let privHier: HybridPrivateKeys | null = null;

          if (encryptedPrivHier) {
            privHier = unwrapPrivateHierarchicalKey(
              encryptedPrivHier,
              wrappedByPublicKey,
              keys.encryptionPrivateKey,
              keys.kemPrivateKey,
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
              parentEntry.privateHierarchicalKeys
            );
            sessionKey = unwrapped.sessionKey;
            privHier = unwrapped.childPrivateHierarchicalKeys;
          } else {
            throw new Error("no decrypt path");
          }

          if (isFolder && privHier && publicHierarchicalKey && publicKemHierarchicalKey) {
            folderPrivHierCache.current.set(f.id as string, {
              publicHierarchicalKey,
              publicKemHierarchicalKey,
              privateHierarchicalKeys: privHier,
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
            ownerEmail: (f.owner_email as string | null) ?? null, ownerDisplayName: (f.owner_display_name as string | null) ?? null,
            createdAt: f.created_at as string,
            updatedAt: f.updated_at as string,
            encryptedPrivateHierarchicalKey: encryptedPrivHier,
            wrappedByPublicKey,
            ownerPublicKey,
            ownerPublicKemKey,
            publicHierarchicalKey,
            publicKemHierarchicalKey,
            encryptedSessionKeyByFile,
            sessionKeyNonce,
            parentKeysClaim,
            parentKeysClaimWrappedBy,
            workspaceId: (f.workspace_id as string | null) ?? null,
            isStarred: !!(f.is_starred),
            hasActiveLink: !!(f.has_active_link),
            evidenceHoldAt: (f.evidence_hold_at as string | null) ?? null,
            seenAt: (f.seen_at as string | null) ?? null,
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
          ownerEmail: (f.owner_email as string | null) ?? null, ownerDisplayName: (f.owner_display_name as string | null) ?? null,
          createdAt: f.created_at as string,
          updatedAt: f.updated_at as string,
          encryptedPrivateHierarchicalKey: (f.encrypted_private_hierarchical_key as string) || "",
          wrappedByPublicKey: (f.wrapped_by_public_key as string) || "",
          ownerPublicKey: (f.owner_public_key as string) || "",
          ownerPublicKemKey: (f.owner_public_kem_key as string) || "",
          publicHierarchicalKey: (f.public_hierarchical_key as string) || "",
          publicKemHierarchicalKey: (f.public_kem_hierarchical_key as string) || "",
          encryptedSessionKeyByFile: (f.encrypted_session_key_by_file as string) || "",
          sessionKeyNonce: (f.session_key_nonce as string) || "",
          parentKeysClaim: (f.parent_keys_claim as string | null) ?? null,
          parentKeysClaimWrappedBy: (f.parent_keys_claim_wrapped_by as string | null) ?? null,
          workspaceId: (f.workspace_id as string | null) ?? null,
          isStarred: !!(f.is_starred),
          hasActiveLink: !!(f.has_active_link),
          evidenceHoldAt: (f.evidence_hold_at as string | null) ?? null,
          seenAt: (f.seen_at as string | null) ?? null,
          fileLabels: [],
          isShared: mode === "shared",
          collaborators: (f.collaborators as FileListCollabShape[] | undefined) ?? [],
          name: "[Encrypted]",
          type: "unknown",
          size: 0,
        });

        // Two-pass decrypt. First pass handles direct-key files,
        // second pass handles inherited (deferred) files.
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
              if (!parentRes.ok) continue;
              const pd = await parentRes.json();
              if (!pd.publicHierarchicalKey || !pd.publicKemHierarchicalKey) continue;

              // Three code paths to recover the parent folder's
              // priv hier — they parallel resolvePrivHier:
              //   1. Direct: caller has their own file_keys row on
              //      the parent.
              //   2. Inherited: caller has a row on an ANCESTOR of
              //      the parent (e.g., workspace root) and walks
              //      parent_keys_claim down through intermediate
              //      folders. This is the bug we're fixing — the
              //      previous version only handled (1) and left
              //      mixed-owner workspace trees showing
              //      "[Encrypted]" for inherited viewers.
              //   3. No path — skip this parent.
              let pPrivHier: HybridPrivateKeys | null = null;
              if (pd.encryptedPrivateHierarchicalKey && pd.wrappedByPublicKey) {
                pPrivHier = unwrapPrivateHierarchicalKey(
                  pd.encryptedPrivateHierarchicalKey,
                  pd.wrappedByPublicKey,
                  keys.encryptionPrivateKey,
                  keys.kemPrivateKey,
                );
              } else if (pd.ancestorKey && pd.parentChain?.length) {
                let current: HybridPrivateKeys = unwrapPrivateHierarchicalKey(
                  pd.ancestorKey.encrypted_private_hierarchical_key,
                  pd.ancestorKey.wrapped_by_public_key,
                  keys.encryptionPrivateKey,
                  keys.kemPrivateKey,
                );
                const chain = pd.parentChain as Array<{
                  parentKeysClaim: string;
                  parentKeysClaimWrappedBy: string;
                }>;
                for (let i = chain.length - 1; i >= 0; i--) {
                  const link = chain[i];
                  const unwrapped = unwrapParentKeysClaim(
                    link.parentKeysClaim,
                    link.parentKeysClaimWrappedBy,
                    current,
                  );
                  current = unwrapped.childPrivateHierarchicalKeys;
                  unwrapped.sessionKey.fill(0);
                }
                pPrivHier = current;
              }

              if (pPrivHier) {
                folderPrivHierCache.current.set(pid, {
                  publicHierarchicalKey: pd.publicHierarchicalKey,
                  publicKemHierarchicalKey: pd.publicKemHierarchicalKey,
                  privateHierarchicalKeys: pPrivHier,
                });
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

        // Restore server order. The decrypt loop ran folders-first
        // for crypto correctness (parent hier keys must be cached
        // before inherited children decrypt), but the final display
        // order must match the server's sort — that's how Recent
        // (accessed_at desc) and other flat views express per-user
        // recency. For Own view the server already returns
        // folders-first, so this is a no-op.
        results.sort((a, b) => {
          const ai = originalPosition.get(a.id) ?? Number.MAX_SAFE_INTEGER;
          const bi = originalPosition.get(b.id) ?? Number.MAX_SAFE_INTEGER;
          return ai - bi;
        });

        // Cache the results for instant navigation next time
        fileListCache.current.set(cacheKey, results);

        // Silent polls: only replace `files` (and callerPermission /
        // nextCursor which are response-bound). Don't touch loading,
        // currentFolder, viewMode, or breadcrumb — the user may have
        // navigated or a modal may have opened between the fetch
        // starting and returning; stomping those fields would be a
        // visible glitch.
        setState((s) => ({
          ...s,
          files: results,
          callerPermission: data.callerPermission ?? null,
          nextCursor: data.nextCursor ?? null,
          ...(silent
            ? {}
            : {
                loading: false,
                currentFolder: mode !== "own" ? null : parentId,
                viewMode: viewModeOverride ?? (mode === "own" && parentId ? s.viewMode : mode),
                ...(breadcrumbOverride ? { breadcrumb: breadcrumbOverride } : {}),
              }),
        }));
      } catch (err) {
        if (mySeq !== fetchFilesSeqRef.current) return;
        console.error("Fetch files error:", err);
        if (!silent) {
          setState((s) => ({ ...s, loading: false, error: "Failed to load files" }));
        }
      }
    },
    [keys, initialized]
  );

  const uploadFile = useCallback(async (file: File, parentId: string | null = null) => {
    if (!keys) return;

    const caps = await getPlanCaps();
    if (caps && file.size > caps.maxFileSizeBytes) {
      setState((s) => ({
        ...s,
        error: `File too large. ${caps.tierLabel} plan allows up to ${formatCap(caps.maxFileSizeBytes)} per file.`,
      }));
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
      ownerEmail: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      encryptedPrivateHierarchicalKey: "",
      wrappedByPublicKey: keys.encryptionPublicKey,
      ownerPublicKey: keys.encryptionPublicKey,
      ownerPublicKemKey: keys.kemPublicKey,
      publicHierarchicalKey: "",
      publicKemHierarchicalKey: "",
      encryptedSessionKeyByFile: "",
      sessionKeyNonce: "",
      parentKeysClaim: null,
      parentKeysClaimWrappedBy: null,
      workspaceId: state.activeWorkspace?.id ?? null,
      isStarred: false,
      hasActiveLink: false,
      evidenceHoldAt: null,
      seenAt: null,
      fileLabels: [],
      isShared: false,
      collaborators: [],
      uploading: true,
      uploadProgress: 5,
    };

    // Prepend instead of append — new files belong at the top of the
    // list so the user sees their upload progress (and the finished
    // file once it lands) without scrolling past 100 existing items.
    // The server already returns files newest-first, so on the next
    // refetch the real row takes over the same position.
    const queueId = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `u-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const queueRecord: UploadRecord = {
      id: queueId,
      name: file.name,
      size: file.size,
      progress: 5,
      status: "uploading",
      kind: "new",
      startedAt: Date.now(),
    };
    setState((s) => ({
      ...s,
      uploading: true,
      uploadStep: "Preparing...",
      uploadProgress: 5,
      error: null,
      files: [placeholderFile, ...s.files],
      uploadQueue: [queueRecord, ...s.uploadQueue],
    }));

    const updateProgress = (progress: number, step: string) => {
      // Deliberately does NOT touch state.files. Before this change,
      // every progress tick ran `files.map(...)` which handed a new
      // array reference to FileBrowser and re-rendered every row in
      // the folder — thousands of wasted renders per upload at
      // ~20-50 ticks/chunk × N rows. The per-file `uploadProgress`
      // field we were rewriting was never actually rendered (assigned
      // into displayFiles but no UI reads it), so losing the in-place
      // bump has zero visual effect. The upload-tray panel still
      // ticks via uploadQueue below, which is cheap because only the
      // tray subscribes to it.
      setState((s) => ({
        ...s,
        uploadStep: step,
        uploadProgress: progress,
        uploadQueue: s.uploadQueue.map((r) =>
          r.id === queueId ? { ...r, progress } : r,
        ),
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
        hier.publicKeys,
        keys.encryptionPrivateKey
      );
      // 1b. Wrap the file's private hier key to the owner's own public
      //     key. This is the row that lives in file_keys and is what
      //     collaborators unwrap after being granted access.
      const encryptedPrivateHierarchicalKey = wrapPrivateHierarchicalKeyForUser(
        hier.privateKeys,
        { x25519: keys.encryptionPublicKey, kem: keys.kemPublicKey },
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
        const parentEntry = await resolveFolderPrivHierById(parentId);
        if (!parentEntry) {
          throw new Error("Cannot access parent folder");
        }
        parentKeysClaim = wrapParentKeysClaim(
          sessionKey,
          hier.privateKeys,
          {
            x25519: parentEntry.publicHierarchicalKey,
            kem: parentEntry.publicKemHierarchicalKey,
          },
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
          publicHierarchicalKey: hier.publicKeys.x25519,
          publicKemHierarchicalKey: hier.publicKeys.kem,
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

      const { fileId, versionId, chunkUrls } = initData;

      // 3. Encrypt and upload chunks with a proper semaphore. The
      //    previous Promise.race + splice loop had two bugs: it
      //    could splice unsettled promises out of the queue, and
      //    the inner Promise.race([p.then(() => true),
      //    Promise.resolve(false)]) always resolved to `false` on
      //    most engines (the synchronously-resolved promise won),
      //    so the queue never actually shrank.
      //
      //    The pattern here keeps TWO collections: `inflight`
      //    (gates concurrency, self-shrinks via finally) and
      //    `allChunks` (the canonical success/failure surface —
      //    Promise.all at the end propagates any chunk error to
      //    the outer try/catch).
      const uploadProgressBase = 15;
      const uploadProgressRange = 80; // 15% to 95%
      let chunksCompleted = 0;
      const inflight = new Set<Promise<void>>();
      const allChunks: Promise<void>[] = [];
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      // Metadata to batch-register at finalize time. Replaces the
      // per-chunk POST /api/files/chunk-upload action:"chunk" that
      // used to run serially inside each chunk's async function —
      // ~330 ms of CF Worker + Supabase round-trip per chunk that
      // held the concurrency gate open while the DB wrote a single
      // row. One batched insert at finalize time is the same DB
      // work wrapped into one trip.
      const registeredChunks: Array<{
        sequence: number;
        shard: number;
        storageKey: string;
        encryptionNonce: string;
        sizeBytes: number;
        isFinal: boolean;
      }> = new Array(totalChunks);

      // `File.slice(...)` is an O(1) view — it does NOT read bytes.
      // The actual disk read is `slice.arrayBuffer()`. Hoisting the
      // read INTO the chunk promise lets the outer loop dispatch all
      // in-flight instantly (slice is cheap); reads overlap with PUTs
      // of earlier chunks.
      for (let index = 0; index < totalChunks; index++) {
        const start = index * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const slice = file.slice(start, end);
        const isFinal = index === totalChunks - 1;
        const chunkUrl = chunkUrls[index];

        const chunkPromise: Promise<void> = (async () => {
          const buffer = await slice.arrayBuffer();
          const encrypted = await getChunkPool().encrypt(
            new Uint8Array(buffer),
            index,
            isFinal,
            sessionKey,
          );

          await putChunkWithRetry(
            chunkUrl.uploadUrl,
            encrypted.ciphertext as unknown as BodyInit,
            {
              refreshUrl: async () => {
                const r = await fetch("/api/files/chunk-upload", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "refresh-urls",
                    fileId,
                    versionId,
                    chunkIndexes: [index],
                  }),
                });
                if (!r.ok) throw new Error(`Chunk ${index} URL refresh failed`);
                const d = await r.json();
                return d.chunkUrls[0].uploadUrl as string;
              },
            },
          );

          // Record metadata for the batched finalize POST. Index
          // position matches sequence so we can drop the array into
          // the payload in-order.
          registeredChunks[index] = {
            sequence: index,
            shard: chunkUrl.shard,
            storageKey: chunkUrl.storageKey,
            encryptionNonce: encrypted.nonce,
            sizeBytes: encrypted.sizeBytes,
            isFinal,
          };

          chunksCompleted++;
          const progress =
            uploadProgressBase + Math.round((chunksCompleted / chunkCount) * uploadProgressRange);
          updateProgress(progress, "Uploading to secure storage...");
        })();

        allChunks.push(chunkPromise);
        inflight.add(chunkPromise);
        // .then(cleanup, cleanup) handles both outcomes without
        // orphaning a rejected follow-on promise (which .finally
        // would). The actual error propagation happens via
        // Promise.all(allChunks) below.
        const cleanup = () => inflight.delete(chunkPromise);
        chunkPromise.then(cleanup, cleanup);

        if (inflight.size >= CONCURRENT_CHUNK_UPLOADS) {
          // Swallow errors here — the canonical propagation point is
          // Promise.all(allChunks) below. Without the catch, Node
          // logs an unhandledRejection for the losing chunk.
          await Promise.race(inflight).catch(() => {});
        }
      }

      // Canonical error surface — any chunk failure (retries
      // exhausted, refresh-URL failed, etc.) propagates here.
      await Promise.all(allChunks);

      // 4. Finalize with the batched chunk metadata.
      updateProgress(96, "Finalizing...");
      await fetch("/api/files/chunk-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "finalize",
          fileId,
          chunks: registeredChunks,
        }),
      });

      // 5. Update the local search cache so this file is discoverable
      //    immediately. Best-effort — a failed cache write doesn't
      //    block the upload, and the next cache rebuild will include
      //    the file anyway.
      {
        const searchEntry: SearchCacheEntry = {
          id: fileId,
          name: file.name,
          isFolder: false,
          type: file.type || "application/octet-stream",
          size: file.size,
          parentId,
          workspaceId: state.activeWorkspace?.id ?? null,
          workspaceName: state.activeWorkspace?.name ?? null,
          breadcrumb: state.activeWorkspace
            ? state.activeWorkspace.name
            : "My Drive",
          updatedAt: new Date().toISOString(),
        };
        try {
          await upsertSearchCache(keys.email, keys.encryptionPrivateKey, searchEntry);
        } catch { /* best-effort */ }
        syncSearchMirror(searchEntry);
      }

      updateProgress(100, "Done");
      await new Promise((r) => setTimeout(r, 400));
      setState((s) => ({
        ...s,
        uploading: false,
        uploadStep: null,
        uploadProgress: 0,
        files: s.files.filter((f) => f.id !== tempId),
        uploadQueue: s.uploadQueue.map((r) =>
          r.id === queueId
            ? { ...r, status: "done", progress: 100, fileId }
            : r,
        ),
      }));
      // Auto-drop the done record from the panel after a beat so it
      // doesn't linger indefinitely. 5s gives the user time to notice
      // "upload finished" without becoming noisy on bulk uploads.
      setTimeout(() => {
        setState((s) => ({
          ...s,
          uploadQueue: s.uploadQueue.filter((r) => r.id !== queueId),
        }));
      }, 5_000);
      // Server bumped accessed_at on upload finalize — nudge Recent.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("securewarp-recent-dirty"));
      }
      await fetchFiles(parentId);
    } catch (err) {
      console.error("Upload error:", err);
      setState((s) => ({
        ...s,
        uploading: false,
        error: "Upload failed",
        files: s.files.filter((f) => f.id !== tempId),
        uploadQueue: s.uploadQueue.map((r) =>
          r.id === queueId
            ? { ...r, status: "error", error: "Upload failed" }
            : r,
        ),
      }));
    } finally {
      // Zero the session key on every exit path — success, error, or
      // early return. Strings (hier keys, wrappedBy) are GC'd by the
      // runtime; typed-array secrets must be cleared explicitly.
      if (sessionKey) sessionKey.fill(0);
    }
  }, [keys, fetchFiles]);

  /**
   * Replace the content of an existing file with a new version. Reuses
   * the file's existing session_key + hierarchical keypair — no new
   * wraps hit the wire, so collaborators keep working and see the new
   * content on next fetch.
   *
   * Client flow:
   *   1. Fetch the file's crypto material (if not already cached) to
   *      recover the shared session key.
   *   2. Encrypt each chunk of the new file with that session key.
   *   3. new-version-init — server allocates a version_number + signed
   *      R2 URLs.
   *   4. PUT each chunk to R2, register it, finalize the version.
   */
  const replaceFile = useCallback(
    async (existingFileId: string, newFile: File) => {
      if (!keys) return;

      const caps = await getPlanCaps();
      if (caps && newFile.size > caps.maxFileSizeBytes) {
        setState((s) => ({
          ...s,
          error: `File too large. ${caps.tierLabel} plan allows up to ${formatCap(caps.maxFileSizeBytes)} per file.`,
        }));
        return;
      }

      let sessionKey: Uint8Array | null = null;
      const chunkCount = getChunkCount(newFile.size);
      // Floating-panel record for this replacement. Tagged kind:
      // "version" so the UI can render a small "new version" label.
      const queueId = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `u-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const queueRecord: UploadRecord = {
        id: queueId,
        name: newFile.name,
        size: newFile.size,
        progress: 5,
        status: "uploading",
        kind: "version",
        startedAt: Date.now(),
        fileId: existingFileId,
      };
      setState((s) => ({
        ...s,
        uploadQueue: [queueRecord, ...s.uploadQueue],
      }));
      const bumpQueue = (progress: number) => {
        setState((s) => ({
          ...s,
          uploadQueue: s.uploadQueue.map((r) =>
            r.id === queueId ? { ...r, progress } : r,
          ),
        }));
      };

      try {
        bumpQueue(10);
        // 1. Fetch the file's pub hier keys (unchanged across versions)
        //    so we can wrap the fresh session key to them. chunk-download
        //    is the existing endpoint that returns them plus access
        //    proof — we ignore the returned session-key wrap because
        //    Phase 4 rotates to a fresh key on every new version.
        const dlRes = await fetch(
          `/api/files/chunk-download?fileId=${existingFileId}`,
        );
        if (!dlRes.ok) {
          setState((s) => ({ ...s, error: "Cannot access file" }));
          return;
        }
        const dlData = await dlRes.json();
        if (!dlData.publicHierarchicalKey || !dlData.publicKemHierarchicalKey) {
          setState((s) => ({ ...s, error: "Missing file hier keys" }));
          return;
        }

        // 2. Generate a fresh session key for this version. Forward
        //    secrecy: a revoked collaborator who cached vN's key
        //    cannot decrypt vN+1, because this key was never
        //    reachable from vN.
        sessionKey = generateSessionKey();

        // 3. Encrypt the new metadata with the fresh session key.
        const encryptedMetadata = encryptMetadata(
          {
            name: newFile.name,
            type: newFile.type || "application/octet-stream",
            size: newFile.size,
          },
          sessionKey,
        );

        // 4. Wrap the fresh session key to the file's existing pub
        //    hier keys. All collaborators keep their file_keys rows
        //    (the hier keypair is unchanged across versions) and
        //    automatically gain read access to the new version.
        const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
          sessionKey,
          { x25519: dlData.publicHierarchicalKey, kem: dlData.publicKemHierarchicalKey },
          keys.encryptionPrivateKey,
        );

        // 4b. If the file has a parent (workspace / inside a folder),
        //     re-wrap its parent_keys_claim with the NEW session key.
        //     parent_keys_claim bundles {sessionKey, childPrivHier}
        //     and lives on the files row; inherited-access readers
        //     (workspace editors without a direct file_keys row)
        //     unwrap it to get BOTH the session key AND the file's
        //     priv hier. Without this re-wrap, v2's metadata is
        //     encrypted with K2 but the claim still carries K1, so
        //     inherited readers decrypt metadata with K1 → "invalid
        //     tag". The file's priv hier itself doesn't rotate, so
        //     we recover it from our own file_keys row and reuse.
        const fileRowInState = state.files.find((f) => f.id === existingFileId);
        const fileParentId = fileRowInState?.parentId ?? null;
        let newParentKeysClaim: string | null = null;
        let newParentKeysClaimWrappedBy: string | null = null;
        if (fileParentId && dlData.encryptedPrivateHierarchicalKey && dlData.wrappedByPublicKey) {
          const filePrivHier = unwrapPrivateHierarchicalKey(
            dlData.encryptedPrivateHierarchicalKey,
            dlData.wrappedByPublicKey,
            keys.encryptionPrivateKey,
            keys.kemPrivateKey,
          );
          // Get parent's pub hier keys. Prefer the in-memory cache
          // (populated when the user navigated into the folder); fall
          // back to a dedicated chunk-download fetch on cache miss.
          const cached = folderPrivHierCache.current.get(fileParentId);
          let parentPubX: string | undefined = cached?.publicHierarchicalKey;
          let parentPubKem: string | undefined = cached?.publicKemHierarchicalKey;
          if (!parentPubX || !parentPubKem) {
            try {
              const pRes = await fetch(
                `/api/files/chunk-download?fileId=${fileParentId}`,
              );
              if (pRes.ok) {
                const pd = await pRes.json();
                parentPubX = pd.publicHierarchicalKey;
                parentPubKem = pd.publicKemHierarchicalKey;
              }
            } catch { /* leave undefined */ }
          }
          if (parentPubX && parentPubKem) {
            newParentKeysClaim = wrapParentKeysClaim(
              sessionKey,
              filePrivHier,
              { x25519: parentPubX, kem: parentPubKem },
              keys.encryptionPrivateKey,
            );
            newParentKeysClaimWrappedBy = keys.encryptionPublicKey;
          }
        }

        // 5. Ask the server to create the next version row + signed URLs.
        const initRes = await fetch("/api/files/chunk-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "new-version-init",
            fileId: existingFileId,
            encryptedMetadata: JSON.stringify(encryptedMetadata),
            totalSizeBytes: newFile.size,
            chunkCount,
            encryptedSessionKeyByFile,
            sessionKeyNonce,
            parentKeysClaim: newParentKeysClaim,
            parentKeysClaimWrappedBy: newParentKeysClaimWrappedBy,
          }),
        });
        const initData = await initRes.json();
        if (!initRes.ok) {
          setState((s) => ({ ...s, error: initData.error ?? "Replace failed" }));
          return;
        }
        const { versionId, chunkUrls } = initData;

        // 4. Upload chunks with the same semaphore pattern as
        //    uploadFile — see the long comment there for why we
        //    keep two collections (inflight vs allChunks), why the
        //    file-read lives inside the chunk promise, and why chunk
        //    metadata is batched into the finalize POST instead of
        //    per-chunk round-trips.
        const inflight = new Set<Promise<void>>();
        const allChunks: Promise<void>[] = [];
        const totalChunks = Math.ceil(newFile.size / CHUNK_SIZE);
        const registeredChunks: Array<{
          sequence: number;
          shard: number;
          storageKey: string;
          encryptionNonce: string;
          sizeBytes: number;
          isFinal: boolean;
        }> = new Array(totalChunks);
        for (let index = 0; index < totalChunks; index++) {
          const start = index * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, newFile.size);
          const slice = newFile.slice(start, end);
          const isFinal = index === totalChunks - 1;
          const chunkUrl = chunkUrls[index];
          const promise: Promise<void> = (async () => {
            const buffer = await slice.arrayBuffer();
            const encrypted = await getChunkPool().encrypt(
              new Uint8Array(buffer),
              index,
              isFinal,
              sessionKey!,
            );
            await putChunkWithRetry(
              chunkUrl.uploadUrl,
              encrypted.ciphertext as unknown as BodyInit,
              {
                refreshUrl: async () => {
                  const r = await fetch("/api/files/chunk-upload", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "refresh-urls",
                      fileId: existingFileId,
                      versionId,
                      chunkIndexes: [index],
                    }),
                  });
                  if (!r.ok) throw new Error(`Chunk ${index} URL refresh failed`);
                  const d = await r.json();
                  return d.chunkUrls[0].uploadUrl as string;
                },
              },
            );
            registeredChunks[index] = {
              sequence: index,
              shard: chunkUrl.shard,
              storageKey: chunkUrl.storageKey,
              encryptionNonce: encrypted.nonce,
              sizeBytes: encrypted.sizeBytes,
              isFinal,
            };
          })();
          allChunks.push(promise);
          inflight.add(promise);
          const cleanup = () => inflight.delete(promise);
          promise.then(cleanup, cleanup);
          if (inflight.size >= CONCURRENT_CHUNK_UPLOADS) {
            await Promise.race(inflight).catch(() => {});
          }
        }
        await Promise.all(allChunks);
        bumpQueue(95);

        // 5. Finalize — server batch-inserts all chunks then flips
        //    files.current_version_number + denormalized metadata.
        await fetch("/api/files/chunk-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "finalize",
            fileId: existingFileId,
            versionId,
            chunks: registeredChunks,
          }),
        });

        // Any cached preview is for the previous version — drop it
        // so the next preview open re-fetches + re-decrypts under
        // the new session key.
        previewCache.current.invalidate(existingFileId);

        // Mark done in the panel; auto-drop after 5s.
        setState((s) => ({
          ...s,
          uploadQueue: s.uploadQueue.map((r) =>
            r.id === queueId ? { ...r, status: "done", progress: 100 } : r,
          ),
        }));
        setTimeout(() => {
          setState((s) => ({
            ...s,
            uploadQueue: s.uploadQueue.filter((r) => r.id !== queueId),
          }));
        }, 5_000);

        await fetchFiles(state.currentFolder);
      } catch (err) {
        console.error("Replace error:", err);
        setState((s) => ({
          ...s,
          error: "Replace failed",
          uploadQueue: s.uploadQueue.map((r) =>
            r.id === queueId ? { ...r, status: "error", error: "Replace failed" } : r,
          ),
        }));
      } finally {
        if (sessionKey) sessionKey.fill(0);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keys, fetchFiles, state.currentFolder],
  );

  /** Remove a single upload from the floating panel (manual dismiss). */
  const dismissUpload = useCallback((uploadId: string) => {
    setState((s) => ({
      ...s,
      uploadQueue: s.uploadQueue.filter((r) => r.id !== uploadId),
    }));
  }, []);

  /** Remove a single download from the floating panel (manual dismiss). */
  const dismissDownload = useCallback((downloadId: string) => {
    setState((s) => ({
      ...s,
      downloadQueue: s.downloadQueue.filter((r) => r.id !== downloadId),
    }));
  }, []);

  /** Fetch every version of a file in newest-first order. */
  const listVersions = useCallback(async (fileId: string) => {
    const res = await fetch(`/api/files/${fileId}/versions`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.versions ?? []) as Array<{
      id: string;
      versionNumber: number;
      encryptedMetadata: string;
      encryptedSessionKeyByFile: string;
      sessionKeyNonce: string;
      sizeBytes: number;
      chunkCount: number;
      createdAt: string;
    }>;
  }, []);

  /** Restore a previous version — creates a new version copying the
   *  source's content. Returns the new version number. */
  const restoreVersion = useCallback(
    async (fileId: string, versionId: string) => {
      const res = await fetch(
        `/api/files/${fileId}/versions/${versionId}/restore`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Restore failed");
      }
      const data = await res.json();
      // Restore bumps the current version. Any cached preview is
      // under a stale session key — drop it.
      previewCache.current.invalidate(fileId);
      await fetchFiles(state.currentFolder);
      return data as { versionId: string; versionNumber: number };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchFiles, state.currentFolder],
  );

  /** Delete a past version. Rejected by the server if it's current. */
  const deleteVersion = useCallback(
    async (fileId: string, versionId: string) => {
      const res = await fetch(`/api/files/${fileId}/versions/${versionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Delete failed");
      }
      return (await res.json()) as { ok: boolean; orphanedStorageKeys: number };
    },
    [],
  );

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
          keys.encryptionPrivateKey,
          keys.kemPrivateKey,
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
        keys.encryptionPrivateKey,
        keys.kemPrivateKey,
      );
      // Walk chain from ancestor DOWN to the target file. The server
      // builds parentChain file-first (chain[0] = target, chain[N-1]
      // = ancestor's immediate child), so we iterate in reverse:
      // currentPrivHier at each step must belong to the PARENT of
      // the link we're unwrapping. chain[N-1].parentKeysClaim is
      // wrapped under the ancestor's pub hier, so we start there.
      // Each hop yields the link's own priv hier, which becomes the
      // key we use for the next shallower hop. The final hop is the
      // target file, whose session key we return.
      const chain = data.parentChain as Array<{
        fileId: string;
        parentKeysClaim: string;
        parentKeysClaimWrappedBy: string;
      }>;
      for (let i = chain.length - 1; i >= 0; i--) {
        const link = chain[i];
        const unwrapped = unwrapParentKeysClaim(
          link.parentKeysClaim,
          link.parentKeysClaimWrappedBy,
          currentPrivHier,
        );
        currentPrivHier = unwrapped.childPrivateHierarchicalKeys;
        if (i === 0) {
          // This is the target file — its session key is what we want.
          return unwrapped.sessionKey;
        }
        // Intermediate link; session key for a folder isn't used.
        unwrapped.sessionKey.fill(0);
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

    // Seed the panel with whatever we know from the current view so
    // the row has a name + size before we've decrypted metadata.
    // 99% of the time the user is downloading a file they clicked
    // on in the active folder, so this is a hit. Read state.files
    // through setState's updater so we don't risk a stale closure
    // on rapid folder navigation.
    const queueId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setState((s) => {
      const viewHit = s.files.find((f) => f.id === fileId);
      const initialRecord: DownloadRecord = {
        id: queueId,
        fileId,
        name: viewHit?.name ?? "Downloading…",
        size: viewHit?.size ?? 0,
        progress: 0,
        status: "downloading",
        startedAt: Date.now(),
      };
      return { ...s, downloadQueue: [initialRecord, ...s.downloadQueue] };
    });

    const updateProgress = (pct: number) => {
      setState((s) => ({
        ...s,
        downloadQueue: s.downloadQueue.map((r) =>
          r.id === queueId ? { ...r, progress: pct } : r,
        ),
      }));
    };

    let sessionKey: Uint8Array | null = null;
    try {
      const res = await fetch(`/api/files/chunk-download?fileId=${fileId}`);
      const data = await res.json();

      if (!res.ok) {
        setState((s) => ({
          ...s,
          error: data.error,
          downloadQueue: s.downloadQueue.map((r) =>
            r.id === queueId
              ? { ...r, status: "error", error: data.error ?? "Download failed" }
              : r,
          ),
        }));
        return;
      }

      updateProgress(5);
      sessionKey = unwrapSessionKeyFromDownload(data);

      // 3. Decrypt metadata
      const encMeta = typeof data.encryptedMetadata === "string"
        ? JSON.parse(data.encryptedMetadata)
        : data.encryptedMetadata;
      const meta = decryptMetadata(encMeta, sessionKey);

      // Promote the real plaintext name + size into the panel row.
      // For files opened via shared link or URL (not clicked in the
      // view), this is when the row's placeholder name resolves.
      setState((s) => ({
        ...s,
        downloadQueue: s.downloadQueue.map((r) =>
          r.id === queueId
            ? { ...r, name: meta.name, size: meta.size ?? r.size }
            : r,
        ),
      }));

      // 5. Open a write target. On Chrome/Edge/Opera this prompts the
      // native save picker and streams bytes straight to disk — the
      // only path that works for the 5 GB / 25 GB paid tiers, since
      // buffering a plaintext blob of that size exceeds the tab heap.
      // On Firefox/Safari, falls back to an in-memory Blob with the
      // existing memory envelope.
      //
      // Force application/octet-stream on the fallback Blob so that
      // even if a middle-click triggers inline navigation, the browser
      // treats it as a save — never inline rendered as HTML/SVG/XML.
      let sink: Awaited<ReturnType<typeof openDownloadSink>>;
      try {
        sink = await openDownloadSink(meta.name, safeMimeForDownload(meta.type));
      } catch (err) {
        if (err instanceof DownloadCancelled) {
          // User dismissed the save picker — silently drop the queue
          // row, no error surface.
          setState((s) => ({
            ...s,
            downloadQueue: s.downloadQueue.filter((r) => r.id !== queueId),
          }));
          return;
        }
        throw err;
      }

      try {
        // Pipelined download: maintain a sliding window of N parallel
        // fetch+decrypt tasks, but drain them to the sink in sequence
        // order. The serial version (fetch → decrypt → write → repeat)
        // ran at single-stream R2 throughput (~10 MB/s) because the
        // network idled during decrypt+write and the write idled during
        // the next chunk's network fetch. With this pipeline the 5
        // configured in-flight slots stay saturated — expected ~5× on
        // large downloads.
        const chunks = data.chunks as { sequence: number; downloadUrl: string; encryptionNonce: string; isFinal: boolean }[];
        const startFetch = (i: number): Promise<Uint8Array> => {
          const chunk = chunks[i];
          return (async () => {
            const r2Res = await fetch(chunk.downloadUrl);
            const encrypted = new Uint8Array(await r2Res.arrayBuffer());
            return getChunkPool().decrypt(encrypted, chunk.encryptionNonce, chunk.sequence, chunk.isFinal, sessionKey!);
          })();
        };
        const inflight: (Promise<Uint8Array> | undefined)[] = new Array(chunks.length);
        const windowSize = Math.min(CONCURRENT_CHUNK_UPLOADS, chunks.length);
        for (let i = 0; i < windowSize; i++) inflight[i] = startFetch(i);
        for (let i = 0; i < chunks.length; i++) {
          const decrypted = await inflight[i]!;
          inflight[i] = undefined;
          await sink.write(decrypted);
          const next = i + CONCURRENT_CHUNK_UPLOADS;
          if (next < chunks.length) inflight[next] = startFetch(next);
          updateProgress(5 + Math.floor(((i + 1) / chunks.length) * 90));
        }
        await sink.close();
      } catch (err) {
        await sink.abort(err);
        throw err;
      }

      setState((s) => ({
        ...s,
        downloadQueue: s.downloadQueue.map((r) =>
          r.id === queueId ? { ...r, status: "done", progress: 100 } : r,
        ),
      }));
      // Signal that the Recent view may be stale — the server just
      // bumped accessed_at for this file, so anyone sitting on the
      // Recent tab should refetch to reflect the new ordering.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("securewarp-recent-dirty"));
      }
      // Auto-drop the completed row after a beat so the tray doesn't
      // pile up on bulk downloads. Matches upload-panel behavior.
      setTimeout(() => {
        setState((s) => ({
          ...s,
          downloadQueue: s.downloadQueue.filter((r) => r.id !== queueId),
        }));
      }, 5_000);
    } catch (err) {
      console.error("Download error:", err);
      setState((s) => ({
        ...s,
        error: "Download failed",
        downloadQueue: s.downloadQueue.map((r) =>
          r.id === queueId
            ? { ...r, status: "error", error: "Download failed" }
            : r,
        ),
      }));
    } finally {
      if (sessionKey) sessionKey.fill(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    ): Promise<PreviewResult> => {
      if (!keys) return { ok: false, error: "Not signed in" };

      // Cache hit: skip the R2 round-trip + re-decrypt entirely.
      // Mint a fresh blob URL from the cached Blob — the caller
      // revokes it on preview close (same contract as the miss
      // path); the Blob itself stays cached until evicted or
      // invalidated. Report 100% immediately so any loading UI
      // doesn't hang at 0%.
      const cached = previewCache.current.get(fileId);
      if (cached) {
        onProgress?.(100);
        return {
          ok: true,
          blobUrl: URL.createObjectURL(cached.blob),
          name: cached.name,
          type: cached.mime,
        };
      }

      // Join an in-flight decrypt for this fileId instead of starting
      // a second pipeline. Snap the joining caller's progress UI to
      // the current % so it doesn't restart at 0, then swap the slot's
      // notify channel to the new callback — live updates now flow to
      // the reopened UI and the original (closed) UI's setter goes
      // quiet. Prevents the "progress jumps 50 → 3 → 51 → 4" effect
      // from two pipelines racing on the same state setter.
      const existing = previewInflight.current.get(fileId);
      if (existing) {
        if (onProgress) {
          onProgress(existing.lastPct);
          existing.notify = onProgress;
        }
        return existing.promise;
      }

      const slot: {
        promise: Promise<PreviewResult>;
        notify: (pct: number) => void;
        lastPct: number;
      } = {
        notify: onProgress ?? (() => {}),
        lastPct: 0,
        // Assigned synchronously before `set()` so joiners always see
        // a valid promise.
        promise: undefined as unknown as Promise<PreviewResult>,
      };

      const promise = (async (): Promise<PreviewResult> => {
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

          const chunks = data.chunks as {
            sequence: number;
            downloadUrl: string;
            encryptionNonce: string;
            isFinal: boolean;
          }[];
          // Pipelined download (same pattern as downloadFile): keep 5
          // fetch+decrypt tasks in flight, drain in order, pre-allocate
          // the output buffer so writes are O(1) index assignment
          // instead of array append + final reassemble.
          const sessionKeyRef = sessionKey;
          const startFetch = (idx: number): Promise<Uint8Array> => {
            const c = chunks[idx];
            return (async () => {
              const r2Res = await fetch(c.downloadUrl);
              const encrypted = new Uint8Array(await r2Res.arrayBuffer());
              return getChunkPool().decrypt(encrypted, c.encryptionNonce, c.sequence, c.isFinal, sessionKeyRef);
            })();
          };
          const inflightPreview: (Promise<Uint8Array> | undefined)[] = new Array(chunks.length);
          const windowSize = Math.min(CONCURRENT_CHUNK_UPLOADS, chunks.length);
          for (let i = 0; i < windowSize; i++) inflightPreview[i] = startFetch(i);
          const decryptedChunks: Uint8Array[] = new Array(chunks.length);
          for (let i = 0; i < chunks.length; i++) {
            decryptedChunks[i] = await inflightPreview[i]!;
            inflightPreview[i] = undefined;
            const next = i + CONCURRENT_CHUNK_UPLOADS;
            if (next < chunks.length) inflightPreview[next] = startFetch(next);
            const pct = Math.round(((i + 1) / chunks.length) * 100);
            slot.lastPct = pct;
            slot.notify(pct);
          }
          const totalSize = decryptedChunks.reduce((s, c) => s + c.length, 0);
          const decryptedContent = new Uint8Array(totalSize);
          let offset = 0;
          for (const c of decryptedChunks) {
            decryptedContent.set(c, offset);
            offset += c.length;
          }

          // Defense in depth: the MIME inside encrypted metadata is
          // uploader-supplied. safeMimeForBlob coerces unrecognized or
          // dangerous types (text/html, SVG, etc.) to octet-stream so
          // the preview pipeline can never render uploaded HTML as
          // same-origin script. We keep the original `type` in the
          // returned object so callers can still branch on it for the
          // correct render path.
          const safeMime = safeMimeForBlob(meta.type);
          const blob = new Blob([new Uint8Array(decryptedContent)], { type: safeMime });
          // Cache the Blob for instant re-open within the session.
          // The preview cache enforces its own size budget + LRU
          // eviction; entries larger than the budget silently skip.
          previewCache.current.set(fileId, {
            blob,
            name: meta.name,
            mime: meta.type,
          });
          return { ok: true, blobUrl: URL.createObjectURL(blob), name: meta.name, type: meta.type };
        } catch (err) {
          console.error("previewFile", err);
          const message = friendlyError(err, "Preview failed");
          return { ok: false, error: message };
        } finally {
          if (sessionKey) sessionKey.fill(0);
          previewInflight.current.delete(fileId);
        }
      })();

      slot.promise = promise;
      previewInflight.current.set(fileId, slot);
      return promise;
    },
    [keys, unwrapSessionKeyFromDownload]
  );

  const createFolder = useCallback(async (name: string, parentId: string | null = null) => {
    if (!keys) return;

    let sessionKey: Uint8Array | null = null;
    try {
      sessionKey = generateSessionKey();
      const hier = generateHierarchicalKeypair();

      const encryptedMetadata = encryptMetadata(
        { name, type: "folder", size: 0 },
        sessionKey
      );

      const { encryptedSessionKeyByFile, sessionKeyNonce } = wrapSessionKeyToFile(
        sessionKey,
        hier.publicKeys,
        keys.encryptionPrivateKey
      );
      const encryptedPrivateHierarchicalKey = wrapPrivateHierarchicalKeyForUser(
        hier.privateKeys,
        { x25519: keys.encryptionPublicKey, kem: keys.kemPublicKey },
        keys.encryptionPrivateKey
      );

      // Phase 3: same parent-claim generation as uploadFile.
      let parentKeysClaim: string | undefined;
      let parentKeysClaimWrappedBy: string | undefined;
      if (parentId) {
        const parentEntry = await resolveFolderPrivHierById(parentId);
        if (!parentEntry) {
          setState((s) => ({ ...s, error: "Cannot access parent folder" }));
          return;
        }
        parentKeysClaim = wrapParentKeysClaim(
          sessionKey,
          hier.privateKeys,
          {
            x25519: parentEntry.publicHierarchicalKey,
            kem: parentEntry.publicKemHierarchicalKey,
          },
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
          publicHierarchicalKey: hier.publicKeys.x25519,
          publicKemHierarchicalKey: hier.publicKeys.kem,
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

      // Add folder to the local search cache.
      if (data.folderId) {
        const searchEntry: SearchCacheEntry = {
          id: data.folderId,
          name,
          isFolder: true,
          type: "folder",
          size: 0,
          parentId,
          workspaceId: state.activeWorkspace?.id ?? null,
          workspaceName: state.activeWorkspace?.name ?? null,
          breadcrumb: state.activeWorkspace
            ? state.activeWorkspace.name
            : "My Drive",
          updatedAt: new Date().toISOString(),
        };
        try {
          await upsertSearchCache(keys.email, keys.encryptionPrivateKey, searchEntry);
        } catch { /* best-effort */ }
        syncSearchMirror(searchEntry);
      }

      await fetchFiles(parentId);
    } catch (err) {
      console.error("Create folder error:", err);
      setState((s) => ({ ...s, error: "Failed to create folder" }));
    } finally {
      if (sessionKey) sessionKey.fill(0);
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
            keys.encryptionPrivateKey,
            keys.kemPrivateKey,
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
          const parentEntry = await resolveFolderPrivHierById(file.parentId);
          if (!parentEntry) {
            return { ok: false, error: "Cannot access parent folder keys" };
          }
          const unwrapped = unwrapParentKeysClaim(
            file.parentKeysClaim,
            file.parentKeysClaimWrappedBy,
            parentEntry.privateHierarchicalKeys
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

        // Update the local search cache with the new name.
        {
          const searchEntry: SearchCacheEntry = {
            id: file.id,
            name: trimmed,
            isFolder: file.isFolder,
            type: file.type,
            size: file.size,
            parentId: file.parentId,
            workspaceId: state.activeWorkspace?.id ?? null,
            workspaceName: state.activeWorkspace?.name ?? null,
            breadcrumb: state.activeWorkspace
              ? state.activeWorkspace.name
              : "My Drive",
            updatedAt: new Date().toISOString(),
          };
          try {
            await upsertSearchCache(keys.email, keys.encryptionPrivateKey, searchEntry);
          } catch { /* best-effort */ }
          syncSearchMirror(searchEntry);
        }

        // Optimistic local update + invalidate cache so other views
        // pick up the new name on next navigation.
        invalidateCache();
        setState((s) => ({
          ...s,
          files: s.files.map((f) => (f.id === file.id ? { ...f, name: trimmed } : f)),
        }));
        // Server just bumped user_file_access for the actor. Let any
        // open Recent view know it's stale so it refetches and this
        // file floats to the top.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("securewarp-recent-dirty"));
        }
        return { ok: true };
      } catch (err) {
        console.error("renameFile", err);
        const message = friendlyError(err, "Rename failed");
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
      destPublicHierarchicalKey: string | null,
      destPublicKemHierarchicalKey: string | null,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!keys) return { ok: false, error: "Not signed in" };
      if (file.parentId === newParentId) return { ok: true };

      let sessionKey: Uint8Array | null = null;
      try {
        let privHier: HybridPrivateKeys;

        if (file.encryptedPrivateHierarchicalKey) {
          privHier = unwrapPrivateHierarchicalKey(
            file.encryptedPrivateHierarchicalKey,
            file.wrappedByPublicKey,
            keys.encryptionPrivateKey,
            keys.kemPrivateKey,
          );
          sessionKey = unwrapSessionKeyFromFile(
            file.encryptedSessionKeyByFile,
            file.sessionKeyNonce,
            file.ownerPublicKey,
            privHier
          );
        } else if (file.parentKeysClaim && file.parentKeysClaimWrappedBy && file.parentId) {
          const parentEntry = await resolveFolderPrivHierById(file.parentId);
          if (!parentEntry) {
            return { ok: false, error: "Cannot access parent folder keys" };
          }
          const unwrapped = unwrapParentKeysClaim(
            file.parentKeysClaim,
            file.parentKeysClaimWrappedBy,
            parentEntry.privateHierarchicalKeys
          );
          sessionKey = unwrapped.sessionKey;
          privHier = unwrapped.childPrivateHierarchicalKeys;
        } else {
          return { ok: false, error: "No decrypt path for this file" };
        }

        let parentKeysClaim: string | null = null;
        let parentKeysClaimWrappedBy: string | null = null;
        if (newParentId !== null) {
          if (!destPublicHierarchicalKey) {
            return { ok: false, error: "Destination pub hier key missing" };
          }
          if (!destPublicKemHierarchicalKey) {
            return { ok: false, error: "Destination pub kem hier key missing" };
          }
          parentKeysClaim = wrapParentKeysClaim(
            sessionKey,
            privHier,
            { x25519: destPublicHierarchicalKey, kem: destPublicKemHierarchicalKey },
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
        console.error("moveFile", err);
        const message = friendlyError(err, "Move failed");
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
        invalidateCache();
        setState((s) => ({
          ...s,
          files: s.files.map((f) =>
            f.id === fileId ? { ...f, isStarred: starred } : f
          ),
        }));
        return { ok: true };
      } catch (err) {
        console.warn("toggleStar failed:", err);
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

      // Remove from local search cache. Best-effort.
      try { await deleteSearchCache(fileId); } catch { /* */ }
      removeFromSearchMirror(fileId);

      // Drop any cached preview — the file is gone (soft-deleted).
      previewCache.current.invalidate(fileId);

      // Optimistic removal — the trashed file shouldn't appear in
      // the non-trash view anymore; drop it from local state and
      // refetch silently so the UI doesn't hang on a full list
      // round-trip before the row disappears.
      setState((s) => ({
        ...s,
        files: s.files.filter((f) => f.id !== fileId),
      }));
      void fetchFiles(state.currentFolder, state.viewMode, undefined, undefined, { silent: true });
    } catch (err) {
      console.error("Delete error:", err);
      setState((s) => ({ ...s, error: "Delete failed" }));
    }
  }, [fetchFiles, state.currentFolder, state.viewMode]);

  /**
   * Resolve the private hierarchical key for a file the caller can
   * decrypt. Two paths:
   *
   *   1. Direct — the caller has a `file_keys` row for this file.
   *      We use the already-populated fields on the DecryptedFile
   *      and unwrap in one hop. Zero server round-trip.
   *   2. Inherited — workspace member (or personal-drive
   *      collaborator) whose access is the parent_keys_claim
   *      chain rooted at an ancestor. Those files come down with
   *      empty `encryptedPrivateHierarchicalKey` /
   *      `wrappedByPublicKey`, so unwrap would throw "bad public
   *      key size". Hit `/api/files/chunk-download` to get the
   *      ancestor key + chain and walk it — same logic
   *      `unwrapSessionKeyFromDownload` uses, just returning the
   *      priv hier key instead of the session key.
   *
   * Used by shareFile + createLink so both invite-by-email and
   * public-link creation work for workspace files regardless of
   * how the caller has access.
   */
  const resolvePrivHier = useCallback(
    async (file: DecryptedFile): Promise<HybridPrivateKeys> => {
      if (!keys) throw new Error("Not signed in");
      // Fast path — direct-key file, one local unwrap.
      if (file.encryptedPrivateHierarchicalKey && file.wrappedByPublicKey) {
        return unwrapPrivateHierarchicalKey(
          file.encryptedPrivateHierarchicalKey,
          file.wrappedByPublicKey,
          keys.encryptionPrivateKey,
          keys.kemPrivateKey,
        );
      }
      // Inherited path — grab the server's parent-chain payload
      // and walk it. chunk-download is the existing endpoint that
      // already returns ancestorKey + parentChain; other fields
      // (download URLs, session key nonce) are ignored here.
      const res = await fetch(`/api/files/chunk-download?fileId=${file.id}`);
      if (!res.ok) throw new Error("Failed to fetch key chain");
      const data = await res.json();
      if (data.encryptedPrivateHierarchicalKey && data.wrappedByPublicKey) {
        return unwrapPrivateHierarchicalKey(
          data.encryptedPrivateHierarchicalKey,
          data.wrappedByPublicKey,
          keys.encryptionPrivateKey,
          keys.kemPrivateKey,
        );
      }
      if (!data.ancestorKey || !data.parentChain?.length) {
        throw new Error("No decryption path available");
      }
      let currentPrivHier: HybridPrivateKeys = unwrapPrivateHierarchicalKey(
        data.ancestorKey.encrypted_private_hierarchical_key,
        data.ancestorKey.wrapped_by_public_key,
        keys.encryptionPrivateKey,
        keys.kemPrivateKey,
      );
      // Chain is file-first (chain[0] = target, last = ancestor's
      // immediate child). Walk it in reverse so currentPrivHier is
      // always the PARENT of the link we're about to unwrap.
      const chain = data.parentChain as Array<{
        parentKeysClaim: string;
        parentKeysClaimWrappedBy: string;
      }>;
      for (let i = chain.length - 1; i >= 0; i--) {
        const link = chain[i];
        const unwrapped = unwrapParentKeysClaim(
          link.parentKeysClaim,
          link.parentKeysClaimWrappedBy,
          currentPrivHier,
        );
        currentPrivHier = unwrapped.childPrivateHierarchicalKeys;
        // Session key isn't needed for this helper — it returns
        // only the file's priv hier.
        unwrapped.sessionKey.fill(0);
      }
      return currentPrivHier;
    },
    [keys],
  );

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

        // 2. Recover the file's private hierarchical key. Direct-key
        //    collaborators unwrap their own file_keys row in one hop;
        //    workspace members with inherited-only access need the
        //    parent_keys_claim chain (resolvePrivHier handles both).
        const privHier = await resolvePrivHier(file);

        // 3. Wrap it to the recipient's public key, with our private key
        //    as the box sender. The recipient will use our public key
        //    (passed as `wrappedByPublicKey`) to unwrap.
        const encryptedForRecipient = wrapPrivateHierarchicalKeyForUser(
          privHier,
          { x25519: pkData.publicEncryptionKey, kem: pkData.publicKemKey },
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
    [keys, resolvePrivHier, fetchFiles, state.currentFolder, state.viewMode]
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
          keys.encryptionPrivateKey,
          keys.kemPrivateKey,
        );
        const oldSessionKey = unwrapSessionKeyFromFile(
          dlData.encryptedSessionKeyByFile,
          dlData.sessionKeyNonce,
          dlData.ownerPublicKey,
          oldPrivHier
        );

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
            await getChunkPool().decrypt(
              encrypted,
              chunk.encryptionNonce,
              chunk.sequence,
              chunk.isFinal,
              oldSessionKey
            )
          );
        }
        const total = decryptedChunks.reduce((s, c) => s + c.length, 0);
        const plaintext = new Uint8Array(total);
        let offset = 0;
        for (const c of decryptedChunks) {
          plaintext.set(c, offset);
          offset += c.length;
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
          newHier.publicKeys,
          keys.encryptionPrivateKey
        );

        // 3. Re-wrap parent_keys_claim if this file has a parent.
        let parentKeysClaim: string | null = null;
        let parentKeysClaimWrappedBy: string | null = null;
        if (file.parentId) {
          const parentEntry = await resolveFolderPrivHierById(file.parentId);
          if (!parentEntry) {
            plaintext.fill(0);
            newSessionKey.fill(0);
            return { ok: false, error: "Cannot access parent folder keys" };
          }
          parentKeysClaim = wrapParentKeysClaim(
            newSessionKey,
            newHier.privateKeys,
            {
              x25519: parentEntry.publicHierarchicalKey,
              kem: parentEntry.publicKemHierarchicalKey,
            },
            keys.encryptionPrivateKey
          );
          parentKeysClaimWrappedBy = keys.encryptionPublicKey;
        }

        // 4. Build remaining-collaborator wraps (owner re-wraps to
        //    themselves, everyone else gets a new per-user wrap).
        type RawCollab = {
          userId: string;
          publicEncryptionKey: string;
          publicKemKey: string;
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
                newHier.privateKeys,
                { x25519: c.publicEncryptionKey, kem: c.publicKemKey },
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
          // Copy into a fresh buffer — the pool transfers ownership to
          // its worker, which would detach `plaintext`'s backing buffer
          // if we passed a subarray that shares it.
          const chunkData = new Uint8Array(plaintext.subarray(start, end));
          const isFinal = i === totalChunks - 1;
          const encrypted = await getChunkPool().encrypt(chunkData, i, isFinal, newSessionKey);
          const target = initData.chunkUrls[i];
          // Rotate has no per-chunk refresh endpoint — the URLs were
          // minted under a one-shot timestamped prefix. Retry on
          // transient 5xx/network errors still helps, but a 403
          // here is terminal and the user needs to retry the whole
          // rotation (rare — 6h TTL covers any realistic rotate).
          await putChunkWithRetry(
            target.uploadUrl,
            encrypted.ciphertext as unknown as BodyInit,
            {},
          );
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
          publicHierarchicalKey: newHier.publicKeys.x25519,
          publicKemHierarchicalKey: newHier.publicKeys.kem,
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
        // Rotation changes the session key — any cached preview was
        // decrypted under the old one and is now dead data. Drop it
        // so the next preview fetches fresh under the new key.
        previewCache.current.invalidate(file.id);
        await fetchFiles(state.currentFolder, state.viewMode);
        return { ok: true };
      } catch (err) {
        console.error("rotateAndRevoke", err);
        return { ok: false, error: friendlyError(err, "Revoke rotation failed") };
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
        publicKemHierarchicalKey: string;
        parentKeysClaim: string | null;
        parentKeysClaimWrappedBy: string | null;
        encryptedSessionKeyByFile: string;
        sessionKeyNonce: string;
      };
      type CollabCtx = {
        userId: string;
        email: string;
        publicEncryptionKey: string;
        publicKemKey: string;
        isOwner: boolean;
        permissionLevel: "owner" | "editor" | "viewer";
      };
      type RotateContext = {
        folder: {
          id: string;
          parentId: string | null;
          publicHierarchicalKey: string;
          publicKemHierarchicalKey: string;
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
        const oldFolderPrivHier: HybridPrivateKeys =
          cachedEntry?.privateHierarchicalKeys ??
          unwrapPrivateHierarchicalKey(
            folder.encryptedPrivateHierarchicalKey,
            folder.wrappedByPublicKey,
            keys.encryptionPrivateKey,
            keys.kemPrivateKey,
          );

        // 3. Unwrap each direct child via the OLD folder priv hier.
        //    We only need {sessionKey, childPrivHier} from each claim.
        //    Skip children that don't have a claim (shouldn't happen
        //    for children of a parented file_keys row, but be safe).
        type Unwrapped = {
          id: string;
          sessionKey: Uint8Array;
          childPrivateHierarchicalKeys: HybridPrivateKeys;
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
          newFolderHier.publicKeys,
          keys.encryptionPrivateKey
        );

        // 7. If F itself has a parent, re-wrap F's own parent_keys_claim
        //    using the parent folder's pub hier (unchanged). Pull it
        //    from the cache.
        let folderParentKeysClaim: string | null = null;
        let folderParentKeysClaimWrappedBy: string | null = null;
        if (folder.parentId) {
          const parentEntry = await resolveFolderPrivHierById(folder.parentId);
          if (!parentEntry) {
            for (const u of unwrapped) u.sessionKey.fill(0);
            newFolderSessionKey.fill(0);
            return { ok: false, error: "Cannot access parent folder keys" };
          }
          folderParentKeysClaim = wrapParentKeysClaim(
            newFolderSessionKey,
            newFolderHier.privateKeys,
            {
              x25519: parentEntry.publicHierarchicalKey,
              kem: parentEntry.publicKemHierarchicalKey,
            },
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
            u.childPrivateHierarchicalKeys,
            newFolderHier.publicKeys,
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
              newFolderHier.privateKeys,
              { x25519: c.publicEncryptionKey, kem: c.publicKemKey },
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
                publicHierarchicalKey: newFolderHier.publicKeys.x25519,
                publicKemHierarchicalKey: newFolderHier.publicKeys.kem,
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
          publicHierarchicalKey: newFolderHier.publicKeys.x25519,
          publicKemHierarchicalKey: newFolderHier.publicKeys.kem,
          privateHierarchicalKeys: newFolderHier.privateKeys,
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
        return { ok: false, error: friendlyError(err, "Folder rotation failed") };
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
        invalidateCache();
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
        // Handles both direct-key and inherited (workspace /
        // subtree) access — see resolvePrivHier above.
        const privHier = await resolvePrivHier(file);
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
        // Flip the per-file indicator so the "Public" pill in the
        // Shared column updates without waiting for a refetch.
        fileListCache.current.clear();
        setState((s) => ({
          ...s,
          files: s.files.map((f) => (f.id === file.id ? { ...f, hasActiveLink: true } : f)),
        }));
        return { ok: true, id: data.id, url };
      } catch (err) {
        console.error("Create link error:", err);
        return { ok: false, error: "Failed to create link" };
      }
    },
    [keys, resolvePrivHier]
  );

  const revokeLink = useCallback(
    async (linkId: string, fileId?: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const res = await fetch(`/api/files/link/${linkId}/revoke`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) return { ok: false, error: data.error || "Failed to revoke" };
        // When the caller tells us which file this link belonged to,
        // re-probe that file's remaining active links and flip the
        // per-file indicator if none remain. The share modal is the
        // canonical caller; it already knows the file id.
        if (fileId) {
          try {
            const linkRes = await fetch(`/api/files/link/list?fileId=${fileId}`);
            const linkData = await linkRes.json();
            const remaining: { id: string }[] = linkData?.links ?? [];
            if (remaining.length === 0) {
              fileListCache.current.clear();
              setState((s) => ({
                ...s,
                files: s.files.map((f) => (f.id === fileId ? { ...f, hasActiveLink: false } : f)),
              }));
            }
          } catch { /* best-effort — next refetch will correct */ }
        }
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
        const bc = [{ id: state.activeWorkspace.rootFolderId, name: state.activeWorkspace.name }];
        await fetchFiles(state.activeWorkspace.rootFolderId, "own", bc);
        return;
      }
      const bc = [{ id: null as string | null, name: "My Drive" }];
      await fetchFiles(null, "own", bc);
      return;
    } else {
      // Broadcast the open so useNewFiles can dismiss the NEW badge
      // regardless of which UI path (click, keyboard, context menu)
      // triggered the navigation. The individual click handlers still
      // call markSeen directly — this is belt-and-suspenders for the
      // paths that forgot to.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("securewarp-file-opened", { detail: { fileId: folderId } }));
      }
      // Compute the new breadcrumb from current state
      const lastCrumb = state.breadcrumb[state.breadcrumb.length - 1];
      if (lastCrumb?.id === folderId) {
        // Double-click guard — just refetch
        await fetchFiles(folderId, "own");
        return;
      }
      const isNonOwn = state.viewMode !== "own";
      const rootName =
        state.viewMode === "starred" ? "Starred"
          : state.viewMode === "recent" ? "Recent"
            : state.viewMode === "shared" ? "Shared with me"
              : null;
      const bc = isNonOwn && rootName
        ? [{ id: null as string | null, name: rootName }, { id: folderId, name: folderName }]
        : [...state.breadcrumb, { id: folderId, name: folderName }];
      await fetchFiles(folderId, "own", bc);
      // Prefetch sibling folders in the background so the next
      // navigation is instant too.
      const siblings = state.files.filter((f) => f.isFolder && f.id !== folderId);
      for (const sib of siblings.slice(0, 5)) {
        prefetchFolder(sib.id);
      }
    }
  }, [fetchFiles, prefetchFolder, state.activeWorkspace, state.breadcrumb, state.viewMode, state.files]);

  /**
   * Switch to a workspace. Sets the workspace root folder as the
   * breadcrumb root so the view is clean (not nested under My Drive).
   * Clicking the breadcrumb root re-fetches the workspace root.
   */
  const navigateToWorkspace = useCallback(async (workspaceId: string, rootFolderId: string, workspaceName: string, workspaceRole?: string) => {
    setState((s) => ({
      ...s,
      files: [],
      loading: true,
      callerPermission: null,
      activeWorkspace: { id: workspaceId, rootFolderId, name: workspaceName, role: workspaceRole || "editor" },
    }));
    const bc = [{ id: rootFolderId, name: workspaceName }];
    // Force viewMode back to "own" on workspace switch. Without the
    // override, fetchFiles preserves s.viewMode when mode==="own" and
    // parentId is truthy (the "drilled into a folder" case), so a
    // user coming from Recent/Starred/Shared would land in the new
    // workspace with a viewMode that the workspace sidebar filters
    // out — leaving no nav item highlighted.
    await fetchFiles(rootFolderId, "own", bc, "own");
  }, [fetchFiles]);

  const leaveWorkspace = useCallback(() => {
    setState((s) => ({ ...s, files: [], loading: true, callerPermission: null, activeWorkspace: null }));
    const bc = [{ id: null as string | null, name: "My Drive" }];
    // Same reason as navigateToWorkspace: snap viewMode to "own" so
    // the personal sidebar highlights My Drive on return from a
    // workspace view.
    fetchFiles(null, "own", bc, "own");
  }, [fetchFiles]);

  /**
   * Jump to a file or folder returned by the search palette and
   * rebuild the breadcrumb from that entry's actual position in
   * the tree — not by appending to the current breadcrumb, which
   * is what navigateToFolder does.
   *
   *   - Folder hit: navigate INTO the folder; breadcrumb ends at
   *     the folder itself.
   *   - File hit: navigate into the file's PARENT folder so the
   *     drive reads as "here's the folder that contains the
   *     search hit", and return the fileId so the caller can open
   *     a preview on top.
   *
   * Resolves the chain from `searchEntriesRef.current` — each
   * entry has `parentId` + `workspaceId` + `workspaceName`,
   * enough to walk from the hit up to its workspace root (or the
   * personal-drive root for non-workspace entries). Bails early
   * if the chain is broken (cache drift) and falls back to
   * navigateToFolder with the entry's immediate name so the user
   * still moves somewhere.
   */
  const navigateToSearchResult = useCallback(
    async (entryId: string): Promise<{ fileIdToPreview: string | null }> => {
      const entries = searchEntriesRef.current ?? [];
      const entryById = new Map(entries.map((e) => [e.id, e] as const));
      const target = entryById.get(entryId);
      if (!target) return { fileIdToPreview: null };

      // Walk parents from the target up, collecting id + name
      // pairs for each intermediate folder. Depth cap mirrors the
      // 32-deep guard in buildBreadcrumb.
      const ancestors: { id: string; name: string }[] = [];
      let cursorId = target.parentId;
      let depth = 0;
      while (cursorId && depth < 32) {
        const parent = entryById.get(cursorId);
        if (!parent) break; // cache gap — stop the walk cleanly
        ancestors.unshift({ id: parent.id, name: parent.name });
        cursorId = parent.parentId;
        depth++;
      }

      // Root crumb depends on whether we're in a workspace.
      const rootCrumb: { id: string | null; name: string } =
        target.workspaceId
          ? {
              // The workspace's root folder id isn't stored on
              // search entries, but `state.activeWorkspace` has it
              // whenever the caller is inside that workspace, which
              // the palette already scopes to.
              id: state.activeWorkspace?.id === target.workspaceId
                ? state.activeWorkspace.rootFolderId
                : null,
              name: target.workspaceName ?? "Workspace",
            }
          : { id: null, name: "My Drive" };

      if (target.isFolder) {
        const bc = [rootCrumb, ...ancestors, { id: target.id, name: target.name }];
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("securewarp-file-opened", { detail: { fileId: target.id } }),
          );
        }
        await fetchFiles(target.id, "own", bc);
        return { fileIdToPreview: null };
      }

      // File hit — navigate into the immediate parent folder (or
      // the drive root when the file sits at the top level).
      const parentId = target.parentId ?? rootCrumb.id;
      const bc = [rootCrumb, ...ancestors];
      await fetchFiles(parentId, "own", bc);
      return { fileIdToPreview: target.id };
    },
    [fetchFiles, state.activeWorkspace],
  );

  const navigateToBreadcrumb = useCallback(async (index: number) => {
    const bc = state.breadcrumb.slice(0, index + 1);
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
      await fetchFiles(null, rootMode, bc);
    } else {
      await fetchFiles(targetId, "own", bc);
    }
  }, [fetchFiles, state.breadcrumb]);

  /**
   * Switch between "My Drive" and "Shared with me". Resets folder context.
   */
  const setViewMode = useCallback(
    async (mode: ViewMode) => {
      if (mode === "own" && state.activeWorkspace) {
        const bc = [{ id: state.activeWorkspace.rootFolderId, name: state.activeWorkspace.name }];
        await fetchFiles(state.activeWorkspace.rootFolderId, "own", bc, "own");
      } else {
        const bc =
          mode === "starred" ? [{ id: null as string | null, name: "Starred" }]
            : mode === "recent" ? [{ id: null as string | null, name: "Recent" }]
              : mode === "trash" ? [{ id: null as string | null, name: "Trash" }]
                : mode === "shared" ? [{ id: null as string | null, name: "Shared with me" }]
                  : [{ id: null as string | null, name: "My Drive" }];
        await fetchFiles(null, mode, bc);
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
        // File and every descendant are gone. Drop the cache entry
        // for the purged id — descendants weren't in the cache
        // keyed under their own ids anyway (purge doesn't give us
        // that list back), so a safer bet is to just clear the
        // whole preview cache on purge.
        previewCache.current.clear();
        // Optimistic local update — drop the purged row from state
        // immediately so the UI feels snappy on a long trash list.
        // Fire-and-forget the full refetch in the background to
        // pick up any server-side state we don't know about
        // (orphan cleanup, cascade effects on shared views, etc.).
        setState((s) => ({
          ...s,
          files: s.files.filter((f) => f.id !== fileId),
        }));
        void fetchFiles(null, state.viewMode, undefined, undefined, { silent: true });
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
        // Every trashed file (and its descendants) is gone. Cheapest
        // correct move: drop the whole preview cache — the alternative
        // is walking trashed-ids and invalidating each.
        previewCache.current.clear();
        // Optimistic: if we're currently in the trash view, clear
        // local files immediately so the list empties without
        // waiting on the refetch. The background refetch reconciles.
        setState((s) =>
          s.viewMode === "trash" ? { ...s, files: [] } : s,
        );
        void fetchFiles(null, "trash", undefined, undefined, { silent: true });
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

  // ── Search cache ─────────────────────────────────────────────────
  // Local-first encrypted cache of decrypted filenames + workspace
  // context, stored in IndexedDB on the user's device. Rebuilt from
  // the server on demand when no cache exists; kept in sync by
  // upload/rename/delete lifecycle hooks. No HMAC tokens, no backfill
  // state machine, no server-side index — just "here's every file
  // you can see, search it locally."
  const searchBuildPromiseRef = useRef<Promise<void> | null>(null);

  /**
   * Build the local search cache from scratch. Fetches every
   * accessible file + workspace, decrypts each row's name (walking
   * the parent_keys_claim chain for workspace-inherited entries),
   * computes a user-friendly breadcrumb, and writes the whole set
   * to IndexedDB under the user's encryption key.
   *
   * Called on demand from searchFiles when no cache exists yet, or
   * when it's older than the freshness threshold. Concurrent calls
   * share a single in-flight promise to avoid redundant work.
   */
  const rebuildSearchCache = useCallback(async () => {
    if (!keys) return;
    const [filesRes, wsRes] = await Promise.all([
      fetch("/api/files/list?all=true&includeWorkspaces=true"),
      fetch("/api/workspaces"),
    ]);
    if (!filesRes.ok) return;
    const data = await filesRes.json();
    const wsData = wsRes.ok ? await wsRes.json() : { workspaces: [] };
    const wsNameById = new Map<string, string>();
    for (const ws of (wsData.workspaces ?? []) as { id: string; name: string }[]) {
      wsNameById.set(ws.id, ws.name);
    }

    type Raw = Record<string, unknown>;
    const rows: Raw[] = data.files ?? [];
    // Key maps feed both metadata decryption and breadcrumb resolution.
    const hierMap = new Map<string, HybridPrivateKeys>(); // fileId → priv hier key
    const nameById = new Map<string, string>(); // fileId → decrypted name
    const entries: SearchCacheEntry[] = [];

    const addEntry = (f: Raw, name: string, type: string, size: number) => {
      nameById.set(f.id as string, name);
      // Workspace roots are decrypted so children can inherit their
      // hier key, but they don't surface as searchable results — they
      // represent the workspace itself, not a user-discoverable folder.
      if (f.is_workspace_root) return;
      entries.push({
        id: f.id as string,
        name,
        isFolder: f.is_folder as boolean,
        type,
        size,
        parentId: (f.parent_id as string | null) ?? null,
        workspaceId: (f.workspace_id as string | null) ?? null,
        workspaceName: f.workspace_id
          ? wsNameById.get(f.workspace_id as string) ?? null
          : null,
        breadcrumb: "", // filled in the final pass once all names are known
        updatedAt: (f.updated_at as string | null) ?? new Date().toISOString(),
      });
    };

    // Pass 1: directly-keyed files. Everything the user has their
    // own wrap for; decrypts with just encryptionPrivateKey.
    const pending: Raw[] = [];
    for (const f of rows) {
      const encPrivHier = (f.encrypted_private_hierarchical_key as string) || "";
      if (!encPrivHier) {
        pending.push(f);
        continue;
      }
      try {
        const privHier = unwrapPrivateHierarchicalKey(
          encPrivHier,
          (f.wrapped_by_public_key as string) || "",
          keys.encryptionPrivateKey,
          keys.kemPrivateKey,
        );
        const sk = unwrapSessionKeyFromFile(
          f.encrypted_session_key_by_file as string,
          f.session_key_nonce as string,
          (f.owner_public_key as string) || "",
          privHier,
        );
        const encMeta = typeof f.encrypted_metadata === "string"
          ? JSON.parse(f.encrypted_metadata as string)
          : f.encrypted_metadata;
        const meta = decryptMetadata(
          encMeta as Parameters<typeof decryptMetadata>[0],
          sk,
        );
        sk.fill(0);
        addEntry(
          f,
          meta.name,
          typeof meta.type === "string" ? meta.type : "",
          typeof meta.size === "number" ? meta.size : 0,
        );
        if (f.is_folder || f.is_workspace_root) hierMap.set(f.id as string, privHier);
      } catch {
        // Undecryptable with direct key; may be solvable via inheritance.
        pending.push(f);
      }
    }

    // Pass 2..N: inherited files (workspace members on shared
    // subtrees). For each pending file, look up its parent's priv
    // hier in hierMap; unwrap parent_keys_claim to get this file's
    // session key + own priv hier; decrypt metadata; cache hier for
    // grandchildren. Iterate until no progress.
    let safety = 0;
    while (pending.length > 0 && safety < 20) {
      safety++;
      const stillPending: Raw[] = [];
      let progressed = false;
      for (const f of pending) {
        const parentId = f.parent_id as string | null;
        const claim = f.parent_keys_claim as string | null;
        const claimBy = f.parent_keys_claim_wrapped_by as string | null;
        const parentHier = parentId ? hierMap.get(parentId) : null;
        if (!parentHier || !claim || !claimBy) {
          stillPending.push(f);
          continue;
        }
        try {
          const unwrapped = unwrapParentKeysClaim(claim, claimBy, parentHier);
          const encMeta = typeof f.encrypted_metadata === "string"
            ? JSON.parse(f.encrypted_metadata as string)
            : f.encrypted_metadata;
          const meta = decryptMetadata(
            encMeta as Parameters<typeof decryptMetadata>[0],
            unwrapped.sessionKey,
          );
          unwrapped.sessionKey.fill(0);
          addEntry(
            f,
            meta.name,
            typeof meta.type === "string" ? meta.type : "",
            typeof meta.size === "number" ? meta.size : 0,
          );
          if (f.is_folder) hierMap.set(f.id as string, unwrapped.childPrivateHierarchicalKeys);
          progressed = true;
        } catch {
          stillPending.push(f);
        }
      }
      pending.length = 0;
      pending.push(...stillPending);
      if (!progressed) break;
    }

    // Breadcrumb pass: walk each entry's parent chain so the result
    // card can show "My Drive → Projects" or "Acme Team →
    // Engineering → Q4". Chain stops when we hit null (personal
    // root) or a workspace root (surfaced as workspaceName).
    const buildBreadcrumb = (entry: SearchCacheEntry): string => {
      const parts: string[] = [];
      let currentId: string | null = entry.parentId;
      let depth = 0;
      while (currentId && depth < 32) {
        const parentName = nameById.get(currentId);
        if (!parentName) break;
        // Find the parent row to decide whether it's a workspace root
        // (stop point) or a regular folder (keep walking).
        const parentRow = rows.find((r) => (r.id as string) === currentId);
        if (!parentRow) break;
        if (parentRow.is_workspace_root) {
          // Reached the workspace root — use the workspace display
          // name at the left of the breadcrumb and stop walking.
          break;
        }
        parts.unshift(parentName);
        currentId = (parentRow.parent_id as string | null) ?? null;
        depth++;
      }
      const root = entry.workspaceName ?? "My Drive";
      return parts.length > 0 ? `${root} → ${parts.join(" → ")}` : root;
    };
    for (const entry of entries) {
      entry.breadcrumb = buildBreadcrumb(entry);
    }

    await replaceSearchCache(keys.email, keys.encryptionPrivateKey, entries);
    await markSearchBuilt(keys.email);
    searchEntriesRef.current = entries;
    oramaDbRef.current = await buildOramaIndex(entries);
    lastBuildMsRef.current = Date.now();
    // eslint-disable-next-line no-console
    console.log("[search.cache] built", {
      email: keys.email,
      total: entries.length,
      workspaces: entries.filter((e) => e.workspaceId).length,
      apiRows: rows.length,
      decrypted: entries.length,
      undecryptable: pending.length,
    });
    if (pending.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "[search.cache] some rows never decrypted — they won't appear in search",
        pending.map((f) => ({
          id: f.id,
          parent_id: f.parent_id,
          is_folder: f.is_folder,
          hasDirectKey: !!f.encrypted_private_hierarchical_key,
          hasParentClaim: !!f.parent_keys_claim,
        })),
      );
    }
    // Expose a browser-console inspector so we can diagnose missing
    // results without adding server telemetry. Safe — the entries are
    // already decrypted on this tab.
    if (typeof window !== "undefined") {
      (window as unknown as { __searchCache?: unknown }).__searchCache = {
        entries,
        lookup: (q: string) => {
          const lo = q.toLowerCase();
          return entries.filter(
            (e) => e.name.toLowerCase().includes(lo) || e.breadcrumb.toLowerCase().includes(lo),
          );
        },
      };
    }
  }, [keys]);

  /**
   * Staleness check + rebuild. Per-item upserts from the client keep
   * the cache fresh for operations this tab knows about, but anything
   * that hits the DB from another device, another tab, a collaborator,
   * or via a code path that forgot to call upsertSearchCache silently
   * drifts. Calling this on Command Palette open forces a rebuild
   * when the cache is older than STALE_MS — fast enough to feel
   * instant (~1–2s for typical drives), bounded enough to catch any
   * drift.
   */
  const STALE_MS = 2 * 60 * 1000; // 2 min
  const refreshSearchCacheIfStale = useCallback(async () => {
    if (!keys) return;
    const last = lastBuildMsRef.current;
    if (last && Date.now() - last < STALE_MS) return;
    // De-dupe concurrent callers onto the same in-flight promise.
    if (!searchBuildPromiseRef.current) {
      searchBuildPromiseRef.current = (async () => {
        try { await rebuildSearchCache(); }
        finally { searchBuildPromiseRef.current = null; }
      })();
    }
    await searchBuildPromiseRef.current;
  }, [keys, rebuildSearchCache]);

  /**
   * Search the local cache. Filename substring match on decrypted
   * names, plus breadcrumb substring so typing a folder name surfaces
   * everything inside it too. Server sees nothing.
   *
   * Ensures the cache exists on first call (builds if missing); all
   * subsequent calls are purely synchronous reads from the in-memory
   * mirror — no async gap between keystrokes, no flicker.
   */
  const searchFiles = useCallback(
    async (
      query: string,
    ): Promise<
      {
        id: string;
        name: string;
        isFolder: boolean;
        parentId: string | null;
        workspaceId: string | null;
        workspaceName: string | null;
        breadcrumb: string;
      }[]
    > => {
      if (!keys) return [];

      // Build the cache on first access. Concurrent callers await the
      // same in-flight promise so we never double-fetch.
      if (!searchEntriesRef.current) {
        if (!searchBuildPromiseRef.current) {
          const existing = await getSearchBuiltAt(keys.email);
          if (existing) {
            // IndexedDB has a prior build from another tab/session —
            // hydrate the in-memory mirror from it, then rebuild the
            // Orama index so typo-tolerant search works without waiting
            // for the next staleness-driven rebuild.
            searchBuildPromiseRef.current = (async () => {
              const loaded = await loadSearchCache(keys.email, keys.encryptionPrivateKey);
              searchEntriesRef.current = loaded;
              oramaDbRef.current = await buildOramaIndex(loaded);
            })();
          } else {
            searchBuildPromiseRef.current = rebuildSearchCache();
          }
        }
        await searchBuildPromiseRef.current;
      }

      const entries = searchEntriesRef.current ?? [];
      const trimmed = query.trim();
      if (!trimmed) return entries.slice(0, 20);

      // Union of two matchers:
      //
      //   1. Orama (BM25 + edit-distance-1 typo tolerance) — handles
      //      fuzzy queries like "buget" → "budget.pdf".
      //   2. Literal substring scan — catches queries that Orama's
      //      English tokenizer drops or over-stems (short tokens,
      //      numeric tokens like "Test 2", dotted names like
      //      "foo.pdf", accented characters).
      //
      // We union both so the user never misses something that exists
      // in the cache. Orama hits come first (ranked), then any
      // substring-only matches tack on at the end.
      const db = oramaDbRef.current;
      const byId = new Map(entries.map((e) => [e.id, e]));
      const ordered: SearchCacheEntry[] = [];
      const seen = new Set<string>();
      if (db) {
        try {
          const res = await searchOrama(db, {
            term: trimmed,
            properties: ["name", "breadcrumb"],
            tolerance: 1,
            boost: { name: 3, breadcrumb: 1 },
            limit: 50,
          });
          for (const hit of res.hits) {
            const entry = byId.get(hit.id as string);
            if (entry && !seen.has(entry.id)) {
              ordered.push(entry);
              seen.add(entry.id);
            }
          }
        } catch {
          // Orama failure falls through to substring below.
        }
      }
      const lower = trimmed.toLowerCase();
      for (const e of entries) {
        if (seen.has(e.id)) continue;
        if (
          e.name.toLowerCase().includes(lower) ||
          e.breadcrumb.toLowerCase().includes(lower)
        ) {
          ordered.push(e);
          seen.add(e.id);
        }
      }
      return ordered.slice(0, 50);
    },
    [keys, rebuildSearchCache],
  );

  // Rebuild the cache when the signed-in user changes. Wipes any
  // prior user's entries (including the in-memory Orama index)
  // before triggering a fresh build so the palette never leaks names
  // across accounts on a shared device.
  useEffect(() => {
    if (!keys) return;
    searchBuildPromiseRef.current = null;
    searchEntriesRef.current = null;
    oramaDbRef.current = null;
    lastBuildMsRef.current = null;
    void (async () => {
      const builtAt = await getSearchBuiltAt(keys.email);
      if (!builtAt) {
        searchBuildPromiseRef.current = rebuildSearchCache();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys?.email]);

  // When the user explicitly signs out, wipe the cache for their
  // email so a subsequent session on the same device starts clean.
  const clearSearchIndex = useCallback(async () => {
    if (!keys) return;
    try { await clearSearchCache(keys.email); } catch { /* */ }
  }, [keys]);

  /**
   * Export all owned files as a zip archive. Fetches every file,
   * decrypts each one client-side, builds the zip with folder
   * structure, and triggers a browser download. Server never sees
   * plaintext.
   */
  const exportAllAsZip = useCallback(
    async (
      onProgress?: (
        pct: number,
        step: string,
        counts?: { done: number; total: number },
      ) => void,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
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
            const privHier = unwrapPrivateHierarchicalKey(encPrivHier, (f.wrapped_by_public_key as string) || "", keys.encryptionPrivateKey, keys.kemPrivateKey);
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
          onProgress?.(
            5 + Math.round((done / nonFolders.length) * 85),
            `Decrypting ${path}...`,
            { done, total: nonFolders.length },
          );

          try {
            const dlRes = await fetch(`/api/files/chunk-download?fileId=${fileId}`);
            const dlData = await dlRes.json();
            if (!dlRes.ok || dlData.noContent) { done++; continue; }

            const sessionKey = unwrapSessionKeyFromDownload(dlData);

            const chunks = dlData.chunks as { sequence: number; downloadUrl: string; encryptionNonce: string; isFinal: boolean }[];
            const decryptedChunks: Uint8Array[] = [];
            for (const chunk of chunks) {
              const r2 = await fetch(chunk.downloadUrl);
              const encrypted = new Uint8Array(await r2.arrayBuffer());
              decryptedChunks.push(await getChunkPool().decrypt(encrypted, chunk.encryptionNonce, chunk.sequence, chunk.isFinal, sessionKey));
            }
            const total = decryptedChunks.reduce((s, c) => s + c.length, 0);
            const content = new Uint8Array(total);
            let offset = 0;
            for (const c of decryptedChunks) { content.set(c, offset); offset += c.length; }
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
        console.error("exportAll", err);
        const message = friendlyError(err, "Export failed");
        return { ok: false, error: message };
      }
    },
    [keys, unwrapSessionKeyFromDownload]
  );

  /**
   * Load the next page of files (cursor-based pagination).
   * Appends to the current file list instead of replacing.
   */
  const loadMore = useCallback(async () => {
    if (!keys || !state.nextCursor) return;
    try {
      const url = `/api/files/list?cursor=${encodeURIComponent(state.nextCursor)}${
        state.currentFolder ? `&parentId=${state.currentFolder}` : ""
      }`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) return;

      const newResults: DecryptedFile[] = [];
      for (const f of data.files) {
        const encPrivHier = (f.encrypted_private_hierarchical_key as string) || "";
        if (!encPrivHier) continue;
        try {
          const privHier = unwrapPrivateHierarchicalKey(encPrivHier, (f.wrapped_by_public_key as string) || "", keys.encryptionPrivateKey, keys.kemPrivateKey);
          const sk = unwrapSessionKeyFromFile(f.encrypted_session_key_by_file, f.session_key_nonce, (f.owner_public_key as string) || "", privHier);
          const encMeta = typeof f.encrypted_metadata === "string" ? JSON.parse(f.encrypted_metadata) : f.encrypted_metadata;
          const meta = decryptMetadata(encMeta, sk);
          sk.fill(0);
          if (f.is_folder && privHier && f.public_hierarchical_key && f.public_kem_hierarchical_key) {
            folderPrivHierCache.current.set(f.id, {
              publicHierarchicalKey: f.public_hierarchical_key,
              publicKemHierarchicalKey: f.public_kem_hierarchical_key,
              privateHierarchicalKeys: privHier,
            });
          }
          newResults.push({
            id: f.id, name: meta.name, type: meta.type, size: meta.size,
            isFolder: f.is_folder, parentId: f.parent_id ?? null,
            ownerId: f.owner_id || "", ownerEmail: (f as Record<string, unknown>).owner_email as string | null ?? null, ownerDisplayName: (f as Record<string, unknown>).owner_display_name as string | null ?? null, createdAt: f.created_at, updatedAt: f.updated_at,
            encryptedPrivateHierarchicalKey: encPrivHier, wrappedByPublicKey: f.wrapped_by_public_key || "",
            ownerPublicKey: f.owner_public_key || "",
            ownerPublicKemKey: f.owner_public_kem_key || "",
            publicHierarchicalKey: f.public_hierarchical_key || "",
            publicKemHierarchicalKey: f.public_kem_hierarchical_key || "",
            encryptedSessionKeyByFile: f.encrypted_session_key_by_file, sessionKeyNonce: f.session_key_nonce,
            parentKeysClaim: f.parent_keys_claim ?? null, parentKeysClaimWrappedBy: f.parent_keys_claim_wrapped_by ?? null,
            isStarred: !!(f.is_starred), hasActiveLink: !!(f.has_active_link), evidenceHoldAt: (f.evidence_hold_at as string | null) ?? null, seenAt: (f.seen_at as string | null) ?? null, fileLabels: f.file_labels ?? [],
            isShared: false, collaborators: f.collaborators ?? [],
          } as DecryptedFile);
        } catch { /* skip */ }
      }
      setState((s) => ({
        ...s,
        files: [...s.files, ...newResults],
        nextCursor: data.nextCursor ?? null,
      }));
    } catch { /* silent */ }
  }, [keys, state.nextCursor, state.currentFolder]);

  // Stable actions bag — each method is already a useCallback with
  // stable identity, so this memo only rebuilds when a specific
  // action's dep changes (rare). Consumers that subscribe via
  // useFilesActions() skip re-renders on every state tick.
  const actions = useMemo(
    () => ({
      fetchFiles,
      uploadFile,
      replaceFile,
      dismissUpload,
      dismissDownload,
      listVersions,
      restoreVersion,
      deleteVersion,
      resolvePrivHier,
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
      navigateToSearchResult,
      clearError,
      invalidateCache,
      loadMore,
      searchFiles,
      refreshSearchCacheIfStale,
      rebuildSearchCache,
      clearSearchIndex,
      exportAllAsZip,
      prefetchFolder,
    }),
    [
      fetchFiles, uploadFile, replaceFile, dismissUpload, dismissDownload,
      listVersions, restoreVersion, deleteVersion, resolvePrivHier,
      downloadFile, previewFile, createFolder, renameFile, moveFile,
      toggleStar, deleteItem, restoreItem, purgeItem, emptyTrash,
      shareFile, unshareFile, leaveShare, rotateAndRevoke, rotateAndRevokeFolder,
      setPermission, createLink, revokeLink, listLinks, loadCollaborators,
      setViewMode, navigateToFolder, navigateToWorkspace, leaveWorkspace,
      navigateToBreadcrumb, navigateToSearchResult, clearError, invalidateCache,
      loadMore, searchFiles, refreshSearchCacheIfStale, rebuildSearchCache,
      clearSearchIndex, exportAllAsZip, prefetchFolder,
    ],
  );

  // State bag — one object containing all reactive state. Memoized
  // on (state, initialized) so its reference is stable between
  // renders where neither changed.
  const stateBag = useMemo(
    () => ({ ...state, initialized }),
    [state, initialized],
  );

  // Legacy flat API — { ...state, ...actions }. Consumers of the
  // legacy FilesContext continue to see this shape. Re-creates every
  // render; that's fine because legacy callers already accepted that
  // cost. New code should prefer useFilesState() / useFilesActions().
  const api = { ...stateBag, ...actions };

  return { api, state: stateBag, actions };
}

export type FilesState = ReturnType<typeof useFiles>["state"];
export type FilesActions = ReturnType<typeof useFiles>["actions"];
export type FilesApi = ReturnType<typeof useFiles>["api"];

/**
 * Split contexts: state (changes every tick) vs actions (stable
 * callbacks). Components that only need actions (modals, share
 * dialog, command palette) should use useFilesActions() to avoid
 * re-rendering on every state update. Components that read state
 * (sidebar, file-browser) use useFilesState(). The combined
 * useFilesContext() is kept for legacy callers.
 */
export const FilesStateContext = createContext<FilesState | null>(null);
export const FilesActionsContext = createContext<FilesActions | null>(null);
export const FilesContext = createContext<FilesApi | null>(null);

export function useFilesState(): FilesState {
  const ctx = useContext(FilesStateContext);
  if (!ctx) throw new Error("useFilesState must be used inside <FilesStateContext.Provider>");
  return ctx;
}

export function useFilesActions(): FilesActions {
  const ctx = useContext(FilesActionsContext);
  if (!ctx) throw new Error("useFilesActions must be used inside <FilesActionsContext.Provider>");
  return ctx;
}

export function useFilesContext(): FilesApi {
  const ctx = useContext(FilesContext);
  if (!ctx) {
    throw new Error("useFilesContext must be used inside a <FilesContext.Provider>");
  }
  return ctx;
}
