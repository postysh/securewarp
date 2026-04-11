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
  unwrapLinkKeyWithPassword,
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

interface LinkMetadataPayload {
  id: string;
  fileId: string;
  isFolder: boolean;
  encryptedPrivateHierarchicalKey: string;
  linkKeyNonce: string;
  hasPassword: boolean;
  passwordSalt: string | null;
  passwordWrappedLinkKey: string | null;
  passwordWrapNonce: string | null;
  file: {
    encryptedMetadata: string;
    publicHierarchicalKey: string;
    encryptedSessionKeyByFile: string;
    sessionKeyNonce: string;
    ownerPublicKey: string;
  };
}

type ShareState =
  | { kind: "loading" }
  | { kind: "invalid"; reason: string }
  | { kind: "password-required"; payload: LinkMetadataPayload; error?: string; submitting?: boolean }
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

function PasswordPrompt({
  error,
  submitting,
  onSubmit,
}: {
  error?: string;
  submitting: boolean;
  onSubmit: (password: string) => void | Promise<void>;
}) {
  const [password, setPassword] = useState("");
  return (
    <div className="text-center">
      <div className="w-14 h-14 mx-auto rounded-xl bg-accent-green/10 flex items-center justify-center mb-4">
        <HugeiconsIcon icon={LockIcon} size={26} color="var(--accent-green-primary)" />
      </div>
      <div className="text-[14px] font-semibold text-text-primary mb-1">Password required</div>
      <div className="text-[12px] text-text-disabled mb-4">
        Enter the password to unlock this shared item.
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!submitting && password) onSubmit(password);
        }}
        className="flex flex-col items-center gap-3"
      >
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          disabled={submitting}
          className="w-full max-w-[280px] px-3 py-2 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40 disabled:opacity-60"
        />
        {error && <div className="text-[11px] text-accent-red">{error}</div>}
        <button
          type="submit"
          disabled={submitting || password.length === 0}
          className="h-[38px] px-5 rounded-[10px] text-[13px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}

export default function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<ShareState>({ kind: "loading" });
  // Cache of every file-id reachable from this link mapped to its own
  // private hierarchical key. Seeded with the link's root file at load
  // time and grown as child walks decrypt additional parent_keys_claim
  // payloads. Used by both folder browsing and file downloads.
  const [folderPrivHier, setFolderPrivHier] = useState<Map<string, string>>(new Map());

  // Deriving a linkKey from the link payload + caller's input (URL
  // fragment OR password) is the single decryption entry point. Split
  // out so the password-prompt path can re-run it after the user types.
  const decryptAndEnter = async (payload: LinkMetadataPayload, linkKey: Uint8Array) => {
    const privHier = unwrapPrivateHierarchicalKeyFromLink(
      payload.encryptedPrivateHierarchicalKey,
      payload.linkKeyNonce,
      linkKey
    );
    const sessionKey = unwrapSessionKeyFromFile(
      payload.file.encryptedSessionKeyByFile,
      payload.file.sessionKeyNonce,
      payload.file.ownerPublicKey,
      privHier
    );
    const encMeta =
      typeof payload.file.encryptedMetadata === "string"
        ? JSON.parse(payload.file.encryptedMetadata)
        : payload.file.encryptedMetadata;
    const meta = decryptMetadata(encMeta, sessionKey);
    sessionKey.fill(0);
    linkKey.fill(0);

    const fileMeta: FileMeta = {
      id: payload.fileId,
      name: meta.name,
      type: meta.type,
      size: meta.size,
      isFolder: payload.isFolder,
    };
    setFolderPrivHier(new Map([[payload.fileId, privHier]]));
    if (payload.isFolder) {
      setState({
        kind: "folder",
        meta: fileMeta,
        stack: [{ id: payload.fileId, name: meta.name }],
        items: [],
      });
    } else {
      setState({ kind: "file", meta: fileMeta });
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/files/link/${id}`);
        if (!res.ok) {
          setState({ kind: "invalid", reason: "This link is no longer valid" });
          return;
        }
        const payload = (await res.json()) as LinkMetadataPayload;

        if (payload.hasPassword) {
          // URL fragment is intentionally empty on password-protected
          // links. Prompt the user for the password instead of reading
          // the fragment.
          setState({ kind: "password-required", payload });
          return;
        }

        const fragment = window.location.hash.replace(/^#/, "");
        if (!fragment) {
          setState({ kind: "invalid", reason: "Missing link key" });
          return;
        }
        const linkKey = decodeLinkKeyFromFragment(fragment);
        await decryptAndEnter(payload, linkKey);
      } catch (err) {
        console.error("share-page load", err);
        setState({ kind: "invalid", reason: "Failed to decrypt link content" });
      }
    })();
  }, [id]);

  const submitPassword = async (password: string) => {
    if (state.kind !== "password-required") return;
    setState({ ...state, submitting: true, error: undefined });
    // Give the browser a tick to render the "Unlocking…" label before
    // Argon2id hogs the main thread for ~300ms.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const payload = state.payload;
      if (!payload.passwordWrappedLinkKey || !payload.passwordSalt || !payload.passwordWrapNonce) {
        throw new Error("Missing password wrap");
      }
      const linkKey = unwrapLinkKeyWithPassword(
        payload.passwordWrappedLinkKey,
        payload.passwordSalt,
        payload.passwordWrapNonce,
        password
      );
      await decryptAndEnter(payload, linkKey);
    } catch {
      setState({ ...state, submitting: false, error: "Wrong password" });
    }
  };

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
            {state.kind === "password-required" && (
              <PasswordPrompt
                error={state.error}
                submitting={state.submitting ?? false}
                onSubmit={submitPassword}
              />
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
