"use client";

// Public link view. This file MUST remain "use client" and MUST NOT call
// getSession(), read cookies, or touch any authenticated API — the whole
// point of the page is that anonymous visitors can open it. The linkKey
// lives only in window.location.hash and is never sent to the server.

import { useEffect, useState, use } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import {
  decodeLinkKeyFromFragment,
  unwrapPrivateHierarchicalKeyFromLink,
  unwrapSessionKeyFromFile,
  unwrapParentKeysClaim,
  decryptMetadata,
} from "@/lib/crypto/file-crypto";
import { decryptChunk } from "@/lib/crypto/chunked-encryption";

interface ChildRow {
  id: string;
  parentId: string | null;
  encryptedMetadata: string;
  isFolder: boolean;
  sizeBytes: number;
  chunkCount: number;
  publicHierarchicalKey: string;
  encryptedSessionKeyByFile: string;
  sessionKeyNonce: string;
  parentKeysClaim: string | null;
  parentKeysClaimWrappedBy: string | null;
  ownerPublicKey: string;
}

interface DecryptedChild extends ChildRow {
  name: string;
  type: string;
  size: number;
  privateHierarchicalKey: string;
}

interface FileMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  isFolder: boolean;
}

type ShareState =
  | { kind: "loading" }
  | { kind: "invalid"; reason: string }
  | { kind: "file"; meta: FileMeta }
  | { kind: "folder"; meta: FileMeta; stack: { id: string; name: string }[]; items: DecryptedChild[] };

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(size < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<ShareState>({ kind: "loading" });
  // Cache of every file-id reachable from this link mapped to its own
  // private hierarchical key. Seeded with the link's root file at load
  // time and grown as child walks decrypt additional parent_keys_claim
  // payloads. Used by both folder browsing and file downloads.
  const [folderPrivHier, setFolderPrivHier] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    (async () => {
      try {
        const fragment = window.location.hash.replace(/^#/, "");
        if (!fragment) {
          setState({ kind: "invalid", reason: "Missing link key" });
          return;
        }

        const res = await fetch(`/api/files/link/${id}`);
        if (!res.ok) {
          setState({ kind: "invalid", reason: "This link is no longer valid" });
          return;
        }
        const data = await res.json();

        const linkKey = decodeLinkKeyFromFragment(fragment);
        const privHier = unwrapPrivateHierarchicalKeyFromLink(
          data.encryptedPrivateHierarchicalKey,
          data.linkKeyNonce,
          linkKey
        );
        const sessionKey = unwrapSessionKeyFromFile(
          data.file.encryptedSessionKeyByFile,
          data.file.sessionKeyNonce,
          data.file.ownerPublicKey,
          privHier
        );

        const encMeta =
          typeof data.file.encryptedMetadata === "string"
            ? JSON.parse(data.file.encryptedMetadata)
            : data.file.encryptedMetadata;
        const meta = decryptMetadata(encMeta, sessionKey);
        sessionKey.fill(0);
        linkKey.fill(0);

        const fileMeta: FileMeta = {
          id: data.fileId,
          name: meta.name,
          type: meta.type,
          size: meta.size,
          isFolder: data.isFolder,
        };
        // Seed the priv hier cache for the link's root file regardless
        // of whether it's a folder or a single file. Folder children use
        // this to walk parent_keys_claim; file downloads use it to
        // unwrap the session key without re-fetching the link.
        setFolderPrivHier(new Map([[data.fileId as string, privHier]]));
        if (data.isFolder) {
          setState({
            kind: "folder",
            meta: fileMeta,
            stack: [{ id: data.fileId, name: meta.name }],
            items: [],
          });
        } else {
          setState({ kind: "file", meta: fileMeta });
        }
      } catch (err) {
        console.error("share-page load", err);
        setState({ kind: "invalid", reason: "Failed to decrypt link content" });
      }
    })();
  }, [id]);

  // When the state becomes folder, fetch the current folder's children.
  useEffect(() => {
    if (state.kind !== "folder") return;
    const currentFolderId = state.stack[state.stack.length - 1].id;
    const parentPriv = folderPrivHier.get(currentFolderId);
    if (!parentPriv) return;

    (async () => {
      const res = await fetch(`/api/files/link/${id}/children?parentId=${currentFolderId}`);
      if (!res.ok) return;
      const data = (await res.json()) as { children: ChildRow[] };

      const newCacheEntries: [string, string][] = [];
      const decrypted: DecryptedChild[] = data.children.map((c) => {
        try {
          if (!c.parentKeysClaim || !c.parentKeysClaimWrappedBy) {
            return {
              ...c,
              name: "[Encrypted]",
              type: "unknown",
              size: 0,
              privateHierarchicalKey: "",
            };
          }
          const unwrapped = unwrapParentKeysClaim(
            c.parentKeysClaim,
            c.parentKeysClaimWrappedBy,
            parentPriv
          );
          const encMeta =
            typeof c.encryptedMetadata === "string"
              ? JSON.parse(c.encryptedMetadata)
              : c.encryptedMetadata;
          const meta = decryptMetadata(encMeta, unwrapped.sessionKey);
          unwrapped.sessionKey.fill(0);
          // Cache for every child — folders need it to walk deeper,
          // files need it to fetch their chunks without another unwrap.
          newCacheEntries.push([c.id, unwrapped.childPrivateHierarchicalKey]);
          return {
            ...c,
            name: meta.name,
            type: meta.type,
            size: meta.size,
            privateHierarchicalKey: unwrapped.childPrivateHierarchicalKey,
          };
        } catch {
          return {
            ...c,
            name: "[Encrypted]",
            type: "unknown",
            size: 0,
            privateHierarchicalKey: "",
          };
        }
      });

      if (newCacheEntries.length > 0) {
        setFolderPrivHier((prev) => {
          const next = new Map(prev);
          for (const [k, v] of newCacheEntries) next.set(k, v);
          return next;
        });
      }
      setState((s) => (s.kind === "folder" ? { ...s, items: decrypted } : s));
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind === "folder" ? state.stack[state.stack.length - 1]?.id : null]);

  const downloadFile = async (fileId: string, name: string, mime: string) => {
    try {
      // Every fileId we render is either the link's root file (seeded
      // into the cache on load) or a descendant unwrapped during a child
      // walk (cached when we decrypted its parent_keys_claim). No
      // fragment round-trip needed here.
      const privHier = folderPrivHier.get(fileId);
      if (!privHier) return;

      const res = await fetch(`/api/files/link/${id}/download?fileId=${fileId}`);
      if (!res.ok) return;
      const data = await res.json();

      const sessionKey = unwrapSessionKeyFromFile(
        data.encryptedSessionKeyByFile,
        data.sessionKeyNonce,
        data.ownerPublicKey,
        privHier
      );

      let decryptedContent: Uint8Array;
      if (data.chunked) {
        const chunks = data.chunks as {
          sequence: number;
          downloadUrl: string;
          encryptionNonce: string;
          isFinal: boolean;
        }[];
        const decryptedChunks: Uint8Array[] = [];
        for (const chunk of chunks) {
          const r2Res = await fetch(chunk.downloadUrl);
          const encrypted = new Uint8Array(await r2Res.arrayBuffer());
          const decrypted = decryptChunk(
            encrypted,
            chunk.encryptionNonce,
            chunk.sequence,
            chunk.isFinal,
            sessionKey
          );
          decryptedChunks.push(decrypted);
        }
        const totalSize = decryptedChunks.reduce((sum, c) => sum + c.length, 0);
        decryptedContent = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of decryptedChunks) {
          decryptedContent.set(chunk, offset);
          offset += chunk.length;
        }
      } else {
        const r2Res = await fetch(data.downloadUrl);
        const encrypted = new Uint8Array(await r2Res.arrayBuffer());
        const { decryptFileContent } = await import("@/lib/crypto/file-crypto");
        decryptedContent = decryptFileContent(encrypted, data.encryptionNonce, sessionKey);
      }

      const blob = new Blob([new Uint8Array(decryptedContent)], { type: mime || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      sessionKey.fill(0);
    } catch (err) {
      console.error("share download", err);
    }
  };

  const enterFolder = (folderId: string, folderName: string) => {
    if (state.kind !== "folder") return;
    setState({ ...state, stack: [...state.stack, { id: folderId, name: folderName }], items: [] });
  };

  const goBack = () => {
    if (state.kind !== "folder") return;
    if (state.stack.length <= 1) return;
    setState({ ...state, stack: state.stack.slice(0, -1), items: [] });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-main p-6">
      <div className="w-full max-w-[560px]">
        <div className="rounded-2xl border border-border-primary bg-bg-l3 overflow-hidden" style={{ boxShadow: "var(--shadow-l2)" }}>
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border-tertiary">
            <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center">
              <HugeiconsIcon icon={LockIcon} size={18} color="var(--accent-green-primary)" />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-text-primary truncate">Secure link</div>
              <div className="text-[11px] text-text-disabled truncate">Encrypted end-to-end</div>
            </div>
          </div>

          <div className="px-5 py-6">
            {state.kind === "loading" && (
              <div className="text-center text-[13px] text-text-tertiary">Decrypting…</div>
            )}
            {state.kind === "invalid" && (
              <div className="text-center">
                <div className="text-[14px] text-text-primary mb-2">Link unavailable</div>
                <div className="text-[12px] text-text-disabled">{state.reason}</div>
              </div>
            )}
            {state.kind === "file" && (
              <div className="text-center">
                <div className="w-14 h-14 mx-auto rounded-xl bg-accent-green/10 flex items-center justify-center mb-4">
                  <HugeiconsIcon icon={File01Icon} size={28} color="var(--accent-green-primary)" />
                </div>
                <div className="text-[15px] font-semibold text-text-primary truncate">{state.meta.name}</div>
                <div className="text-[12px] text-text-disabled mt-1">{formatBytes(state.meta.size)}</div>
                <button
                  onClick={() => downloadFile(state.meta.id, state.meta.name, state.meta.type)}
                  className="mt-5 h-[38px] px-5 rounded-[10px] text-[13px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] flex items-center gap-2 mx-auto"
                >
                  <HugeiconsIcon icon={Download04Icon} size={15} /> Download
                </button>
              </div>
            )}
            {state.kind === "folder" && (
              <div>
                <div className="flex items-center gap-2 mb-3 text-[12px] text-text-tertiary">
                  {state.stack.length > 1 && (
                    <button onClick={goBack} className="text-text-secondary hover:text-text-primary cursor-pointer transition-colors">
                      ← Back
                    </button>
                  )}
                  <span className="font-medium text-text-primary truncate">
                    {state.stack[state.stack.length - 1].name}
                  </span>
                </div>
                {state.items.length === 0 ? (
                  <div className="py-8 text-center text-[12px] text-text-disabled">Empty folder</div>
                ) : (
                  <div className="rounded-[10px] border border-border-tertiary overflow-hidden">
                    {state.items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() =>
                          item.isFolder
                            ? enterFolder(item.id, item.name)
                            : downloadFile(item.id, item.name, item.type)
                        }
                        className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-border-tertiary last:border-b-0 hover:bg-bg-cell-hover transition-colors text-left cursor-pointer"
                      >
                        <HugeiconsIcon
                          icon={item.isFolder ? Folder01Icon : File01Icon}
                          size={18}
                          color={item.isFolder ? "var(--accent-blue-primary)" : "var(--icon-secondary)"}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] text-text-primary truncate">{item.name}</div>
                          {!item.isFolder && (
                            <div className="text-[11px] text-text-disabled">{formatBytes(item.size)}</div>
                          )}
                        </div>
                        {!item.isFolder && (
                          <HugeiconsIcon icon={Download04Icon} size={15} color="var(--icon-tertiary)" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
