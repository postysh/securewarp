"use client";

// Public link view. This file MUST remain "use client" and MUST NOT call
// getSession(), read cookies, or touch any authenticated API — the whole
// point of the page is that anonymous visitors can open it. The linkKey
// lives only in window.location.hash and is never sent to the server.

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { BrandMark } from "@/components/brand-mark";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import Image01Icon from "@hugeicons/core-free-icons/Image01Icon";
import CodeIcon from "@hugeicons/core-free-icons/CodeIcon";
import Table01Icon from "@hugeicons/core-free-icons/Table01Icon";
import MusicNote01Icon from "@hugeicons/core-free-icons/MusicNote01Icon";
import Video01Icon from "@hugeicons/core-free-icons/Video01Icon";
import Archive01Icon from "@hugeicons/core-free-icons/Archive01Icon";
import Pdf01Icon from "@hugeicons/core-free-icons/Pdf01Icon";
import Presentation01Icon from "@hugeicons/core-free-icons/Presentation01Icon";
import FileEditIcon from "@hugeicons/core-free-icons/FileEditIcon";
import Flag01Icon from "@hugeicons/core-free-icons/Flag01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import type { FileKind } from "@/components/file-icon";
import {
  decodeLinkKeyFromFragment,
  unwrapPrivateHierarchicalKeyFromLink,
  unwrapSessionKeyFromFile,
  unwrapParentKeysClaim,
  unwrapLinkKeyWithPassword,
  decryptMetadata,
  type HybridPrivateKeys,
} from "@/lib/crypto/file-crypto";
import { getChunkPool } from "@/lib/crypto/chunk-pool";
import {
  openDownloadSink,
  DownloadCancelled,
  BrowserCannotStreamLargeDownload,
  prewarmDownloadSw,
} from "@/lib/net/download-sink";
import { safeMimeForDownload } from "@/lib/mime-safety";

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
  privateHierarchicalKey: HybridPrivateKeys | null;
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
  sharedByName: string | null;
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
  | { kind: "file"; meta: FileMeta; sharedByName: string | null }
  | { kind: "folder"; meta: FileMeta; sharedByName: string | null; stack: { id: string; name: string }[]; items: DecryptedChild[] };

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return `${size.toFixed(size < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

// Same mapping used by the file-browser's getFileKind, duplicated here
// so the anonymous share page doesn't pull in the authenticated
// component. Keep in sync with src/components/file-browser.tsx.
function getFileKind(name: string, type: string): FileKind {
  if (type === "folder") return "folder";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, FileKind> = {
    pdf: "pdf", doc: "document", docx: "document", txt: "document", md: "document",
    png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image", webp: "image",
    js: "code", ts: "code", py: "code", rb: "code", go: "code", rs: "code", jsx: "code", tsx: "code",
    xls: "spreadsheet", xlsx: "spreadsheet", csv: "spreadsheet",
    mp3: "audio", wav: "audio", ogg: "audio", flac: "audio",
    mp4: "video", mov: "video", avi: "video", mkv: "video",
    zip: "archive", tar: "archive", gz: "archive", rar: "archive", "7z": "archive",
    pptx: "presentation", ppt: "presentation", key: "presentation",
  };
  return map[ext] || "other";
}

const HERO_ICON: Record<FileKind, { icon: typeof File01Icon; color: string }> = {
  folder:       { icon: Folder01Icon,       color: "var(--accent-blue-primary)" },
  document:     { icon: File01Icon,         color: "var(--accent-dark-blue-primary)" },
  image:        { icon: Image01Icon,        color: "var(--accent-pink-primary)" },
  code:         { icon: CodeIcon,           color: "var(--accent-orange-primary)" },
  spreadsheet:  { icon: Table01Icon,        color: "var(--accent-yellow-primary)" },
  audio:        { icon: MusicNote01Icon,    color: "var(--accent-pink-primary)" },
  video:        { icon: Video01Icon,        color: "var(--accent-red-primary)" },
  archive:      { icon: Archive01Icon,      color: "var(--accent-yellow-primary)" },
  pdf:          { icon: Pdf01Icon,          color: "var(--accent-red-primary)" },
  presentation: { icon: Presentation01Icon, color: "var(--accent-orange-primary)" },
  page:         { icon: FileEditIcon,       color: "var(--accent-dark-blue-primary)" },
  other:        { icon: File01Icon,         color: "var(--icon-tertiary)" },
};

function EyebrowLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-disabled mb-3">
      {children}
    </div>
  );
}

function TrustPill() {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border-tertiary bg-bg-side">
      <HugeiconsIcon icon={Shield01Icon} size={12} color="var(--text-link)" />
      <span className="text-[11px] font-mono uppercase tracking-wider text-text-tertiary">
        Encrypted end-to-end
      </span>
    </div>
  );
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
        className="w-full max-w-[280px] px-3 py-2 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-text-link/25 transition-all border border-transparent focus:border-text-link/40 disabled:opacity-60"
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
  );
}

type ReportCategory = "csam" | "harassment" | "malware" | "copyright" | "illegal" | "other";

const REPORT_CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: "csam", label: "Child sexual abuse material (CSAM)" },
  { value: "harassment", label: "Harassment or targeted abuse" },
  { value: "malware", label: "Malware, phishing, or scam" },
  { value: "copyright", label: "Copyright infringement" },
  { value: "illegal", label: "Other illegal content" },
  { value: "other", label: "Something else" },
];

function ReportDialog({
  linkId,
  onClose,
}: {
  linkId: string;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<ReportCategory>("csam");
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (submitting) return;
    if (details.trim().length < 10) {
      setError("Please describe the issue in at least 10 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { linkId, category, details: details.trim() };
      if (email.trim()) body.reporterEmail = email.trim();
      const res = await fetch("/api/abuse/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        throw new Error((data as { error?: string }).error || "Report failed");
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="w-full max-w-[440px] rounded-2xl border border-border-tertiary bg-bg-l3 overflow-hidden"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={Flag01Icon} size={15} color="var(--accent-red-primary)" />
            <div className="text-[13px] font-semibold text-text-primary">Report this content</div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-bg-cell-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} color="var(--icon-tertiary)" />
          </button>
        </div>

        {done ? (
          <div className="px-5 py-8 text-center">
            <div className="text-[14px] font-semibold text-text-primary mb-1">Report received</div>
            <div className="text-[12px] text-text-disabled mb-5">
              Thank you. Our trust and safety team will review this report.
            </div>
            <button
              onClick={onClose}
              className="h-[36px] px-5 rounded-[10px] text-[12px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-all cursor-pointer active:scale-[0.98]"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="px-5 py-4 flex flex-col gap-4">
            <div className="text-[11px] text-text-tertiary leading-relaxed">
              SecureWarp stores files encrypted. We cannot read the contents. Your report helps our team take action on the share link and the uploader. See our{" "}
              <Link
                href="/trust-and-safety"
                target="_blank"
                className="text-text-link hover:underline"
              >
                trust and safety policy
              </Link>
              .
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-mono uppercase tracking-wider text-text-tertiary">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ReportCategory)}
                disabled={submitting}
                className="w-full px-3 py-2 rounded-[10px] bg-bg-field text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-text-link/25 border border-transparent focus:border-text-link/40 disabled:opacity-60"
              >
                {REPORT_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-mono uppercase tracking-wider text-text-tertiary">
                What is the issue?
              </label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                disabled={submitting}
                maxLength={2000}
                rows={4}
                placeholder="Describe what you saw, include URLs or context that helps us act quickly."
                className="w-full px-3 py-2 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-text-link/25 border border-transparent focus:border-text-link/40 resize-none disabled:opacity-60"
              />
              <div className="text-[10px] text-text-disabled text-right">
                {details.length} / 2000
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-mono uppercase tracking-wider text-text-tertiary">
                Your email (optional)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                maxLength={256}
                placeholder="So we can follow up if needed"
                className="w-full px-3 py-2 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-text-link/25 border border-transparent focus:border-text-link/40 disabled:opacity-60"
              />
            </div>

            {error && <div className="text-[11px] text-accent-red">{error}</div>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                disabled={submitting}
                className="h-[36px] px-4 rounded-[10px] text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-cell-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting || details.trim().length < 10}
                className="h-[36px] px-5 rounded-[10px] text-[12px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReportLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-text-disabled hover:text-text-tertiary transition-colors cursor-pointer"
    >
      <HugeiconsIcon icon={Flag01Icon} size={11} />
      Report this content
    </button>
  );
}

export default function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<ShareState>({ kind: "loading" });
  // Cache of every file-id reachable from this link mapped to its own
  // private hierarchical key. Seeded with the link's root file at load
  // time and grown as child walks decrypt additional parent_keys_claim
  // payloads. Used by both folder browsing and file downloads.
  const [folderPrivHier, setFolderPrivHier] = useState<Map<string, HybridPrivateKeys>>(new Map());
  // Per-file-id download progress, 0..100. A null entry means not
  // downloading; the button/row reads this to render the current
  // chunk-fetch percent so large files don't feel stuck.
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [reportOpen, setReportOpen] = useState(false);

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
        sharedByName: payload.sharedByName,
        stack: [{ id: payload.fileId, name: meta.name }],
        items: [],
      });
    } else {
      setState({ kind: "file", meta: fileMeta, sharedByName: payload.sharedByName });
    }
  };

  // Prewarm the streaming-download service worker on mount. Visitors
  // hit "Download" within seconds of landing here; without prewarm the
  // first click pays the full register-and-claim round-trip while
  // chunks pile up in memory waiting for a sink.
  useEffect(() => {
    prewarmDownloadSw();
  }, []);

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

      const newCacheEntries: [string, HybridPrivateKeys][] = [];
      const decrypted: DecryptedChild[] = data.children.map((c) => {
        try {
          if (!c.parentKeysClaim || !c.parentKeysClaimWrappedBy) {
            return {
              ...c,
              name: "[Encrypted]",
              type: "unknown",
              size: 0,
              privateHierarchicalKey: null,
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
          newCacheEntries.push([c.id, unwrapped.childPrivateHierarchicalKeys]);
          return {
            ...c,
            name: meta.name,
            type: meta.type,
            size: meta.size,
            privateHierarchicalKey: unwrapped.childPrivateHierarchicalKeys,
          };
        } catch {
          return {
            ...c,
            name: "[Encrypted]",
            type: "unknown",
            size: 0,
            privateHierarchicalKey: null,
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

  const downloadFile = async (
    fileId: string,
    name: string,
    mime: string,
    sizeBytes: number = 0,
  ) => {
    // Every fileId we render is either the link's root file (seeded
    // into the cache on load) or a descendant unwrapped during a child
    // walk (cached when we decrypted its parent_keys_claim). No
    // fragment round-trip needed here.
    const privHier = folderPrivHier.get(fileId);
    if (!privHier) return;
    if (downloadProgress[fileId] !== undefined) return; // already in flight
    let sessionKey: Uint8Array | null = null;
    let sink: Awaited<ReturnType<typeof openDownloadSink>> | null = null;
    try {
      setDownloadProgress((p) => ({ ...p, [fileId]: 0 }));

      const res = await fetch(`/api/files/link/${id}/download?fileId=${fileId}`);
      if (!res.ok) throw new Error("download metadata");
      const data = await res.json();

      sessionKey = unwrapSessionKeyFromFile(
        data.encryptedSessionKeyByFile,
        data.sessionKeyNonce,
        data.ownerPublicKey,
        privHier,
      );

      const chunks = data.chunks as {
        sequence: number;
        downloadUrl: string;
        encryptionNonce: string;
        isFinal: boolean;
      }[] | undefined;
      if (!chunks || chunks.length === 0) {
        throw new Error("Folders can't be downloaded directly");
      }

      // Open the streaming sink BEFORE we start fetching chunks. On
      // Safari/Firefox this triggers the SW iframe (zero in-page
      // memory accumulation); on Chromium it shows the FSA save
      // picker. Refused with a clear error if the file's too big for
      // the in-memory blob fallback.
      sink = await openDownloadSink(
        name,
        safeMimeForDownload(mime),
        sizeBytes,
      );

      // Pipelined chunk fetch + decrypt — same pattern as the drive's
      // downloadFile. 5 in-flight slots saturate the network without
      // letting the page heap build up an arbitrary backlog.
      const CONCURRENCY = 5;
      const total = chunks.length;
      const startFetch = (i: number): Promise<Uint8Array> => {
        const chunk = chunks[i];
        return (async () => {
          const r2Res = await fetch(chunk.downloadUrl);
          if (!r2Res.ok) throw new Error(`chunk ${chunk.sequence} fetch failed`);
          const encrypted = new Uint8Array(await r2Res.arrayBuffer());
          return getChunkPool().decrypt(
            encrypted,
            chunk.encryptionNonce,
            chunk.sequence,
            chunk.isFinal,
            sessionKey!,
          );
        })();
      };
      const inflight: (Promise<Uint8Array> | undefined)[] = new Array(total);
      const windowSize = Math.min(CONCURRENCY, total);
      for (let i = 0; i < windowSize; i++) inflight[i] = startFetch(i);
      for (let i = 0; i < total; i++) {
        const decrypted = await inflight[i]!;
        inflight[i] = undefined;
        await sink.write(decrypted);
        const next = i + CONCURRENCY;
        if (next < total) inflight[next] = startFetch(next);
        setDownloadProgress((p) => ({
          ...p,
          [fileId]: Math.round(((i + 1) / total) * 100),
        }));
      }
      await sink.close();
      sink = null;
    } catch (err) {
      if (sink) {
        try { await sink.abort(err); } catch { /* terminal */ }
      }
      if (err instanceof DownloadCancelled) {
        // User dismissed the FSA save picker — silent drop.
      } else if (err instanceof BrowserCannotStreamLargeDownload) {
        // Surface the message somewhere visible. The share page
        // doesn't have a toast surface; fall back to alert() so the
        // user understands why nothing downloaded instead of seeing a
        // silent no-op.
        if (typeof window !== "undefined") {
          window.alert(err.message);
        }
      } else {
        console.error("share download", err);
      }
    } finally {
      if (sessionKey) sessionKey.fill(0);
      setDownloadProgress((p) => {
        const next = { ...p };
        delete next[fileId];
        return next;
      });
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
    <div className="min-h-screen flex flex-col bg-bg-side">
      {reportOpen && (
        <ReportDialog linkId={id} onClose={() => setReportOpen(false)} />
      )}
      {/* Brand bar — ties the anonymous link page back to the
          marketing site so recipients see where the share came from. */}
      <header className="flex items-center justify-between px-6 py-5">
        <Link
          href="/"
          className="no-underline text-text-primary text-[13px] font-semibold hover:opacity-80 transition-opacity flex items-center gap-2"
          style={{ fontFamily: "var(--font-geist-mono), monospace", letterSpacing: "0.1em" }}
        >
          <BrandMark size={72} />
          SECUREWARP
        </Link>
        <div className="text-[11px] font-mono uppercase tracking-wider text-text-tertiary">
          Shared with you
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-10">
        <div className="w-full max-w-[480px]">
          <div className="rounded-2xl border border-border-tertiary bg-bg-l3 overflow-hidden" style={{ boxShadow: "var(--shadow-l2)" }}>
            {state.kind === "loading" && (
              <div className="px-6 py-14 text-center text-[13px] text-text-tertiary">Decrypting…</div>
            )}

            {state.kind === "invalid" && (
              <>
                <div className="bg-bg-side px-6 py-8 text-center border-b border-border-tertiary">
                  <EyebrowLabel>Unavailable</EyebrowLabel>
                  <div className="w-14 h-14 mx-auto rounded-xl bg-bg-l3 border border-border-tertiary flex items-center justify-center mb-4">
                    <HugeiconsIcon icon={LockIcon} size={24} color="var(--icon-tertiary)" />
                  </div>
                  <div className="text-[15px] font-semibold text-text-primary mb-1">Link unavailable</div>
                  <div className="text-[12px] text-text-disabled">{state.reason}</div>
                </div>
              </>
            )}

            {state.kind === "password-required" && (
              <>
                <div className="bg-bg-side px-6 py-8 text-center border-b border-border-tertiary">
                  <EyebrowLabel>Locked</EyebrowLabel>
                  <div className="w-14 h-14 mx-auto rounded-xl bg-bg-l3 border border-border-tertiary flex items-center justify-center mb-4">
                    <HugeiconsIcon icon={LockIcon} size={24} color="var(--text-link)" />
                  </div>
                  <div className="text-[15px] font-semibold text-text-primary mb-1">Password required</div>
                  <div className="text-[12px] text-text-disabled">Enter the password to unlock this shared item.</div>
                </div>
                <div className="px-6 py-6">
                  <PasswordPrompt
                    error={state.error}
                    submitting={state.submitting ?? false}
                    onSubmit={submitPassword}
                  />
                </div>
              </>
            )}

            {state.kind === "file" && (() => {
              const kind = getFileKind(state.meta.name, state.meta.type);
              const hero = HERO_ICON[kind];
              const progress = downloadProgress[state.meta.id];
              const downloading = progress !== undefined;
              const sharedBy = state.sharedByName?.trim() || "A SecureWarp user";
              return (
                <>
                  <div className="bg-bg-side px-6 py-8 text-center border-b border-border-tertiary">
                    <EyebrowLabel>Shared file</EyebrowLabel>
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-bg-l3 border border-border-tertiary flex items-center justify-center mb-5">
                      <HugeiconsIcon icon={hero.icon} size={30} color={hero.color} />
                    </div>
                    <div className="text-[16px] font-semibold text-text-primary truncate">{state.meta.name}</div>
                    <div className="text-[12px] text-text-disabled mt-1">
                      {formatBytes(state.meta.size)} · Shared by {sharedBy}
                    </div>
                  </div>
                  <div className="px-6 py-6 flex flex-col items-center gap-4">
                    <TrustPill />
                    <button
                      onClick={() => downloadFile(state.meta.id, state.meta.name, state.meta.type, state.meta.size)}
                      disabled={downloading}
                      className="h-[40px] px-6 rounded-[10px] text-[13px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] flex items-center gap-2 disabled:opacity-80 disabled:cursor-wait disabled:active:scale-100"
                    >
                      <HugeiconsIcon icon={Download04Icon} size={15} />
                      {downloading ? `Downloading… ${progress}%` : "Download"}
                    </button>
                    <ReportLink onClick={() => setReportOpen(true)} />
                  </div>
                </>
              );
            })()}

            {state.kind === "folder" && (() => {
              const sharedBy = state.sharedByName?.trim() || "A SecureWarp user";
              const folderName = state.stack[state.stack.length - 1].name;
              return (
                <>
                  <div className="bg-bg-side px-6 py-6 border-b border-border-tertiary">
                    <EyebrowLabel>Shared folder</EyebrowLabel>
                    <div className="flex items-center gap-2 justify-center">
                      {state.stack.length > 1 && (
                        <button
                          onClick={goBack}
                          className="text-[12px] text-text-secondary hover:text-text-primary cursor-pointer transition-colors shrink-0"
                        >
                          ← Back
                        </button>
                      )}
                      <HugeiconsIcon icon={Folder01Icon} size={16} color="var(--accent-blue-primary)" />
                      <span className="text-[15px] font-semibold text-text-primary truncate">
                        {folderName}
                      </span>
                    </div>
                    <div className="text-[11px] text-text-disabled mt-1 text-center">Shared by {sharedBy}</div>
                  </div>
                  <div className="px-5 py-5">
                    {state.items.length === 0 ? (
                      <div className="py-8 text-center text-[12px] text-text-disabled">Empty folder</div>
                    ) : (
                      <div className="rounded-[10px] border border-border-tertiary overflow-hidden">
                        {state.items.map((item) => {
                          const itemKind = getFileKind(item.name, item.isFolder ? "folder" : item.type);
                          const itemHero = HERO_ICON[itemKind];
                          const itemProgress = downloadProgress[item.id];
                          const itemDownloading = itemProgress !== undefined;
                          return (
                            <button
                              key={item.id}
                              onClick={() =>
                                item.isFolder
                                  ? enterFolder(item.id, item.name)
                                  : downloadFile(item.id, item.name, item.type, item.size)
                              }
                              disabled={itemDownloading}
                              className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-border-tertiary last:border-b-0 hover:bg-bg-cell-hover transition-colors text-left cursor-pointer disabled:cursor-wait"
                            >
                              <div className="w-8 h-8 rounded-md bg-bg-side flex items-center justify-center shrink-0">
                                <HugeiconsIcon icon={itemHero.icon} size={16} color={itemHero.color} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[13px] text-text-primary truncate">{item.name}</div>
                                {!item.isFolder && (
                                  <div className="text-[11px] text-text-disabled">
                                    {itemDownloading ? `Downloading… ${itemProgress}%` : formatBytes(item.size)}
                                  </div>
                                )}
                              </div>
                              {!item.isFolder && (
                                <HugeiconsIcon icon={Download04Icon} size={15} color="var(--icon-tertiary)" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="mt-5 flex flex-col items-center gap-3">
                      <TrustPill />
                      <ReportLink onClick={() => setReportOpen(true)} />
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
          <div className="mt-5 text-center text-[12px] text-text-tertiary">
            Encrypt your own files.{" "}
            <Link
              href="/"
              className="text-text-primary font-medium hover:opacity-80 transition-opacity"
            >
              Get SecureWarp →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
