"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import ReloadIcon from "@hugeicons/core-free-icons/ReloadIcon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Upload04Icon from "@hugeicons/core-free-icons/Upload04Icon";
import { decryptMetadata } from "@/lib/crypto/file-crypto";
import { fromBase64 } from "@/lib/crypto/utils";
import nacl from "tweetnacl";
import {
  unwrapPrivateHierarchicalKey,
  unwrapSessionKeyFromFile,
} from "@/lib/crypto/file-crypto";
import { useUserKeys } from "@/hooks/use-user-keys";

/**
 * Version history modal. Fetches all versions for a file, decrypts
 * each version's metadata with the shared session key, renders a list
 * newest-first with restore + delete actions per past version.
 *
 * Decryption happens entirely client-side. The server returns only the
 * encrypted metadata blob — it never sees historical filenames or
 * sizes as plaintext.
 */

type FileForVersions = {
  id: string;
  name: string;
  isOwner: boolean;
  currentVersionNumber?: number;
  // Crypto material needed to unwrap the shared session key once per
  // modal open. Mirrors the DecryptedFile shape from use-files.ts.
  encryptedPrivateHierarchicalKey: string;
  wrappedByPublicKey: string;
  ownerPublicKey: string;
  encryptedSessionKeyByFile: string;
  sessionKeyNonce: string;
};

interface VersionRaw {
  id: string;
  versionNumber: number;
  encryptedMetadata: string;
  sizeBytes: number;
  chunkCount: number;
  createdAt: string;
}

interface VersionRow extends VersionRaw {
  decryptedName: string;
}

interface VersionHistoryModalProps {
  file: FileForVersions | null;
  onClose: () => void;
  // Callers pass the hook functions directly so this component stays
  // pure (no import cycle with use-files).
  listVersions: (fileId: string) => Promise<VersionRaw[]>;
  restoreVersion: (
    fileId: string,
    versionId: string,
  ) => Promise<{ versionId: string; versionNumber: number }>;
  deleteVersion: (
    fileId: string,
    versionId: string,
  ) => Promise<{ ok: boolean; orphanedStorageKeys: number }>;
  // Upload a new version. Optional — when present the modal renders
  // an "Upload new version" button in the header that opens a native
  // file picker and pipes the result here.
  replaceFile?: (fileId: string, file: File) => Promise<void>;
  onActionComplete?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function VersionHistoryModal({
  file,
  onClose,
  listVersions,
  restoreVersion,
  deleteVersion,
  replaceFile,
  onActionComplete,
}: VersionHistoryModalProps) {
  const userKeys = useUserKeys();
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const newVersionInputRef = useRef<HTMLInputElement>(null);

  const fetchAndDecrypt = useCallback(async () => {
    if (!file || !userKeys) return;
    setLoading(true);
    setError(null);
    let sessionKey: Uint8Array | null = null;
    try {
      // Recover the shared session key once — every version uses it.
      const privHier = unwrapPrivateHierarchicalKey(
        file.encryptedPrivateHierarchicalKey,
        file.wrappedByPublicKey,
        userKeys.encryptionPrivateKey,
      );
      sessionKey = unwrapSessionKeyFromFile(
        file.encryptedSessionKeyByFile,
        file.sessionKeyNonce,
        file.ownerPublicKey,
        privHier,
      );

      const raw = await listVersions(file.id);
      const decrypted: VersionRow[] = raw.map((v) => {
        try {
          const encMeta =
            typeof v.encryptedMetadata === "string"
              ? JSON.parse(v.encryptedMetadata)
              : v.encryptedMetadata;
          const meta = decryptMetadata(encMeta, sessionKey!);
          return { ...v, decryptedName: meta.name };
        } catch {
          return { ...v, decryptedName: "(name unavailable)" };
        }
      });
      setVersions(decrypted);
    } catch {
      setError("Failed to load version history");
    } finally {
      if (sessionKey) sessionKey.fill(0);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, userKeys, listVersions]);

  useEffect(() => {
    if (file) fetchAndDecrypt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  useEffect(() => {
    if (!file) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [file, onClose]);

  const handleRestore = useCallback(
    async (versionId: string) => {
      if (!file) return;
      setBusy(versionId);
      setError(null);
      try {
        await restoreVersion(file.id, versionId);
        onActionComplete?.();
        await fetchAndDecrypt();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Restore failed");
      } finally {
        setBusy(null);
      }
    },
    [file, restoreVersion, fetchAndDecrypt, onActionComplete],
  );

  const handleReplace = useCallback(
    async (picked: File) => {
      if (!file || !replaceFile) return;
      setUploading(true);
      setError(null);
      try {
        await replaceFile(file.id, picked);
        onActionComplete?.();
        await fetchAndDecrypt();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [file, replaceFile, fetchAndDecrypt, onActionComplete],
  );

  const handleDelete = useCallback(
    async (versionId: string) => {
      if (!file) return;
      setBusy(versionId);
      setError(null);
      try {
        await deleteVersion(file.id, versionId);
        setConfirmDelete(null);
        onActionComplete?.();
        await fetchAndDecrypt();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
      } finally {
        setBusy(null);
      }
    },
    [file, deleteVersion, fetchAndDecrypt, onActionComplete],
  );

  const currentVersionNumber = useMemo(() => {
    if (file?.currentVersionNumber) return file.currentVersionNumber;
    return versions.length > 0 ? versions[0].versionNumber : 1;
  }, [file?.currentVersionNumber, versions]);

  // Keep unused imports' type checker happy (nacl + fromBase64 are
  // reserved for a future per-version key-rotation migration).
  void nacl;
  void fromBase64;

  if (!file) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Version history"
        className="relative w-full h-full md:h-auto max-w-none md:max-w-[520px] md:max-h-[85vh] mx-0 md:mx-4 rounded-none md:rounded-2xl bg-bg-l3 border-0 md:border border-border-primary overflow-hidden animate-fade-in flex flex-col"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center shrink-0">
              <HugeiconsIcon
                icon={Clock01Icon}
                size={18}
                color="var(--accent-blue-primary)"
              />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-text-primary truncate">
                Version history
              </div>
              <div className="text-[11px] text-text-disabled truncate">
                {file.name}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {file.isOwner && replaceFile && (
              <button
                onClick={() => newVersionInputRef.current?.click()}
                disabled={uploading || busy !== null}
                className="h-[30px] px-3 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <HugeiconsIcon icon={Upload04Icon} size={13} />
                {uploading ? "Uploading…" : "Upload new version"}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={16} />
            </button>
          </div>
          {/* Hidden file input for the "Upload new version" action.
              Lives here so a successful upload immediately refreshes
              the modal's own version list. */}
          <input
            ref={newVersionInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) handleReplace(picked);
              e.target.value = "";
            }}
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="text-[13px] text-text-tertiary">Loading…</div>
          ) : error ? (
            <div className="text-[13px] text-accent-red">{error}</div>
          ) : versions.length === 0 ? (
            <div className="text-[13px] text-text-tertiary">
              No history yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {versions.map((v) => {
                const isCurrent = v.versionNumber === currentVersionNumber;
                return (
                  <div
                    key={v.id}
                    className="rounded-[10px] border border-border-tertiary bg-bg-l2 px-3.5 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-text-primary">
                            v{v.versionNumber}
                          </span>
                          {isCurrent && (
                            <span
                              className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                              style={{
                                background: "rgba(110,210,170,0.12)",
                                color: "rgba(110,210,170,0.95)",
                              }}
                            >
                              Current
                            </span>
                          )}
                          <span className="text-[11px] text-text-disabled">
                            · {formatRelative(v.createdAt)}
                          </span>
                        </div>
                        <div className="text-[11px] text-text-tertiary mt-1 truncate">
                          {v.decryptedName} · {formatBytes(v.sizeBytes)}
                        </div>
                      </div>
                      {!isCurrent && file.isOwner && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleRestore(v.id)}
                            disabled={busy !== null}
                            className="h-[28px] px-2.5 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-cta-nav-hover transition-colors cursor-pointer inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <HugeiconsIcon icon={ReloadIcon} size={12} />
                            {busy === v.id ? "Restoring…" : "Restore"}
                          </button>
                          {confirmDelete === v.id ? (
                            <button
                              onClick={() => handleDelete(v.id)}
                              disabled={busy !== null}
                              className="h-[28px] px-2.5 rounded-[6px] text-[11px] font-medium text-text-inverse bg-accent-red hover:opacity-90 transition-all cursor-pointer inline-flex items-center gap-1 disabled:opacity-50"
                            >
                              Confirm
                            </button>
                          ) : (
                            <button
                              onClick={() => setConfirmDelete(v.id)}
                              disabled={busy !== null}
                              className="h-[28px] px-2.5 rounded-[6px] text-[11px] font-medium text-accent-red hover:bg-accent-red/10 transition-colors cursor-pointer inline-flex items-center gap-1 disabled:opacity-50"
                            >
                              <HugeiconsIcon icon={Delete02Icon} size={12} />
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-border-tertiary text-[11px] text-text-disabled">
          Restore creates a new version; history is preserved.
        </div>
      </div>
    </div>,
    document.body,
  );
}
