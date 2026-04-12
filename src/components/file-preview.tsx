"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import MinusSignIcon from "@hugeicons/core-free-icons/MinusSignIcon";
import { useFilesContext } from "@/hooks/use-files";

interface FilePreviewProps {
  fileId: string | null;
  fileIds: string[];
  onClose: () => void;
  onNavigate: (fileId: string) => void;
}

function isImage(type: string): boolean {
  return type.startsWith("image/");
}
function isVideo(type: string): boolean {
  return type.startsWith("video/");
}
function isAudio(type: string): boolean {
  return type.startsWith("audio/");
}
function isText(type: string): boolean {
  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/xml" ||
    type === "text/xml"
  );
}
function isPreviewable(type: string): boolean {
  return (
    isImage(type) ||
    isVideo(type) ||
    isAudio(type) ||
    type === "application/pdf" ||
    isText(type)
  );
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

export function FilePreview({ fileId, fileIds, onClose, onNavigate }: FilePreviewProps) {
  const fileOps = useFilesContext();
  const [loading, setLoading] = useState(false);
  const [decryptProgress, setDecryptProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    blobUrl: string;
    name: string;
    type: string;
  } | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const blobUrlRef = useRef<string | null>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);

  const cleanup = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setPreview(null);
    setTextContent(null);
    setError(null);
    setZoom(1);
  }, []);

  const loadPreview = useCallback(
    async (id: string) => {
      cleanup();
      setLoading(true);
      setDecryptProgress(null);
      const result = await fileOps.previewFile(id, (pct) => setDecryptProgress(pct));
      setLoading(false);
      setDecryptProgress(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      blobUrlRef.current = result.blobUrl;
      setPreview({ blobUrl: result.blobUrl, name: result.name, type: result.type });

      if (isText(result.type)) {
        try {
          const res = await fetch(result.blobUrl);
          const text = await res.text();
          setTextContent(text.slice(0, 500_000));
        } catch {
          setTextContent("[Could not read file]");
        }
      }
    },
    [fileOps, cleanup]
  );

  useEffect(() => {
    if (fileId) loadPreview(fileId);
    else cleanup();
    return cleanup;
  }, [fileId]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentIndex = fileId ? fileIds.indexOf(fileId) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < fileIds.length - 1;

  const goPrev = useCallback(() => {
    if (hasPrev) onNavigate(fileIds[currentIndex - 1]);
  }, [hasPrev, currentIndex, fileIds, onNavigate]);

  const goNext = useCallback(() => {
    if (hasNext) onNavigate(fileIds[currentIndex + 1]);
  }, [hasNext, currentIndex, fileIds, onNavigate]);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM)), []);
  const zoomReset = useCallback(() => setZoom(1), []);

  useEffect(() => {
    if (!fileId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "+" || e.key === "=") zoomIn();
      if (e.key === "-") zoomOut();
      if (e.key === "0") zoomReset();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [fileId, onClose, goPrev, goNext, zoomIn, zoomOut, zoomReset]);

  // Scroll-wheel zoom on images
  useEffect(() => {
    const el = imgContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setZoom((z) => Math.min(Math.max(z + delta, MIN_ZOOM), MAX_ZOOM));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  });

  if (!fileId) return null;

  const fileName = preview?.name ?? fileOps.files.find((f) => f.id === fileId)?.name ?? "File";
  const showZoom = preview && isImage(preview.type);
  const zoomPct = Math.round(zoom * 100);

  const triggerDownload = () => {
    if (!preview) return;
    const a = document.createElement("a");
    a.href = preview.blobUrl;
    a.download = preview.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col bg-black/90 animate-fade-in">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 h-[56px] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 text-white/40 text-[11px]">
            <HugeiconsIcon icon={LockIcon} size={12} />
            Decrypted locally
          </div>
          <span className="text-[14px] font-medium text-white truncate ml-2">
            {fileName}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Zoom controls — images only */}
          {showZoom && (
            <div className="flex items-center gap-0.5 mr-2">
              <button
                onClick={zoomOut}
                className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={MinusSignIcon} size={14} />
              </button>
              <button
                onClick={zoomReset}
                className="flex items-center justify-center h-[28px] px-2 rounded-[6px] text-[11px] font-mono text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer min-w-[48px]"
              >
                {zoomPct}%
              </button>
              <button
                onClick={zoomIn}
                className="flex items-center justify-center w-[28px] h-[28px] rounded-[6px] text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <HugeiconsIcon icon={PlusSignIcon} size={14} />
              </button>
            </div>
          )}
          {preview && (
            <button
              onClick={triggerDownload}
              className="flex items-center gap-1.5 h-[32px] px-3 rounded-[8px] text-[12px] font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Download04Icon} size={14} />
              Download
            </button>
          )}
          <button
            onClick={onClose}
            className="flex items-center justify-center w-[32px] h-[32px] rounded-[8px] text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={18} />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 flex items-center justify-center overflow-hidden relative">
        {/* Prev/Next arrows */}
        {hasPrev && (
          <button
            onClick={goPrev}
            className="absolute left-4 z-10 flex items-center justify-center w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={20} />
          </button>
        )}
        {hasNext && (
          <button
            onClick={goNext}
            className="absolute right-4 z-10 flex items-center justify-center w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors cursor-pointer"
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={20} />
          </button>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-3">
            {decryptProgress !== null ? (
              <>
                <div className="w-[200px] h-[4px] bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white/70 rounded-full transition-all duration-200"
                    style={{ width: `${decryptProgress}%` }}
                  />
                </div>
                <span className="text-[13px] text-white/50">
                  Decrypting… {decryptProgress}%
                </span>
              </>
            ) : (
              <>
                <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
                <span className="text-[13px] text-white/50">Decrypting…</span>
              </>
            )}
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="text-center max-w-[320px]">
            <p className="text-[14px] text-white/70 mb-2">Preview unavailable</p>
            <p className="text-[12px] text-white/40">{error}</p>
          </div>
        )}

        {/* Image preview with zoom */}
        {!loading && preview && isImage(preview.type) && (
          <div
            ref={imgContainerRef}
            className="flex items-center justify-center overflow-auto w-full h-full"
            onDoubleClick={zoomReset}
          >
            <img
              src={preview.blobUrl}
              alt={preview.name}
              className="select-none transition-transform duration-150"
              style={{
                transform: `scale(${zoom})`,
                maxWidth: zoom <= 1 ? "90vw" : undefined,
                maxHeight: zoom <= 1 ? "85vh" : undefined,
              }}
              draggable={false}
            />
          </div>
        )}

        {/* Video preview */}
        {!loading && preview && isVideo(preview.type) && (
          <video
            src={preview.blobUrl}
            controls
            autoPlay
            className="max-w-[90vw] max-h-[85vh] rounded-lg"
          >
            Your browser does not support this video format.
          </video>
        )}

        {/* Audio preview */}
        {!loading && preview && isAudio(preview.type) && (
          <div className="flex flex-col items-center gap-6 max-w-[400px]">
            <div className="w-24 h-24 rounded-2xl bg-white/5 flex items-center justify-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <span className="text-[14px] text-white/70 text-center truncate max-w-full">
              {preview.name}
            </span>
            <audio src={preview.blobUrl} controls autoPlay className="w-full">
              Your browser does not support this audio format.
            </audio>
          </div>
        )}

        {/* PDF preview */}
        {!loading && preview && preview.type === "application/pdf" && (
          <embed
            src={`${preview.blobUrl}#view=FitH`}
            type="application/pdf"
            className="w-[90vw] h-[85vh] max-w-[1000px] rounded-lg"
          />
        )}

        {/* Text preview */}
        {!loading && preview && textContent !== null && isText(preview.type) && (
          <div className="w-[90vw] max-w-[800px] max-h-[85vh] overflow-auto rounded-lg bg-[#1a1a2e] p-6">
            <pre className="text-[13px] text-white/80 font-mono whitespace-pre-wrap break-words leading-relaxed">
              {textContent}
            </pre>
          </div>
        )}

        {/* Unsupported type */}
        {!loading && preview && !isPreviewable(preview.type) && (
          <div className="text-center max-w-[320px]">
            <p className="text-[14px] text-white/70 mb-2">No preview available</p>
            <p className="text-[12px] text-white/40 mb-4">
              {preview.type || "Unknown type"} — {preview.name}
            </p>
            <button
              onClick={triggerDownload}
              className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium bg-white/10 text-white hover:bg-white/20 transition-colors cursor-pointer"
            >
              Download instead
            </button>
          </div>
        )}
      </div>

      {/* Bottom bar — file counter */}
      {fileIds.length > 1 && (
        <div className="flex items-center justify-center h-[40px] shrink-0">
          <span className="text-[11px] text-white/30">
            {currentIndex + 1} of {fileIds.length}
          </span>
        </div>
      )}
    </div>,
    document.body
  );
}
