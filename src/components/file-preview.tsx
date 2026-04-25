"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Download04Icon from "@hugeicons/core-free-icons/Download04Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import Key02Icon from "@hugeicons/core-free-icons/Key02Icon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import MinusSignIcon from "@hugeicons/core-free-icons/MinusSignIcon";
import { useScramble } from "use-scramble";
import { useFilesContext } from "@/hooks/use-files";
import {
  isPreviewableMime,
  isTextPreviewMime,
  isDocxMime,
  isXlsxMime,
} from "@/lib/mime-safety";
import { CodePreview } from "@/components/code-preview";

interface FilePreviewProps {
  fileId: string | null;
  fileIds: string[];
  onClose: () => void;
  onNavigate: (fileId: string) => void;
}

// Per-category predicates intersect the explicit allowlist in
// mime-safety.ts. They must stay in sync — `isPreviewableMime`
// returning true for a MIME that no render branch handles would show
// an unusable placeholder, but it won't compromise security. The
// reverse (a render branch that accepts a non-allowlisted MIME) is
// the real hazard; don't add one.
function isImage(type: string): boolean {
  return isPreviewableMime(type) && type.startsWith("image/");
}
function isVideo(type: string): boolean {
  return isPreviewableMime(type) && type.startsWith("video/");
}
function isAudio(type: string): boolean {
  return isPreviewableMime(type) && type.startsWith("audio/");
}
function isText(type: string): boolean {
  return isTextPreviewMime(type);
}
function isPreviewable(type: string): boolean {
  return isPreviewableMime(type);
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
  // Generation counter — bumped every time we start a new load OR
  // tear one down via cleanup(). Each loadPreview captures its own
  // gen at start; any state setter or progress callback fired after
  // the gen advances is silently dropped. Without this, a stale
  // load that resolved on a different file (close X, open Y mid-
  // decrypt of X) would still call setPreview/setTextContent on the
  // current view, AND the % handed to setDecryptProgress would be
  // for a file the user no longer has open — that was the source of
  // the "% goes all over the place" report on reopen.
  const loadGenRef = useRef(0);

  const cleanup = useCallback(() => {
    // Bump first so any in-flight load's setters become no-ops.
    loadGenRef.current++;
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setPreview(null);
    setTextContent(null);
    setError(null);
    setZoom(1);
    // Reset loading + progress so the SVG ring unmounts cleanly on
    // close. CSS transitions on stroke-dasharray would otherwise
    // animate backwards from the last % to the new one when the
    // user reopens, which is the visible "ring goes all over the
    // place" symptom.
    setLoading(false);
    setDecryptProgress(null);
  }, []);

  const loadPreview = useCallback(
    async (id: string) => {
      cleanup();
      const myGen = loadGenRef.current;
      setLoading(true);
      setDecryptProgress(null);
      const result = await fileOps.previewFile(id, (pct) => {
        if (loadGenRef.current === myGen) setDecryptProgress(pct);
      });
      if (loadGenRef.current !== myGen) return;
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
          if (loadGenRef.current !== myGen) return;
          const text = await res.text();
          if (loadGenRef.current !== myGen) return;
          setTextContent(text.slice(0, 500_000));
        } catch {
          if (loadGenRef.current === myGen) setTextContent("[Could not read file]");
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

  // Hoist fileName computation above early return — the scramble
  // hook below needs the target text and hooks can't be conditional.
  // Known-file lookup works even while `fileId` is null (returns "File")
  // and the early-return below still skips the actual render.
  const fileName = preview?.name ?? fileOps.files.find((f) => f.id === fileId)?.name ?? "File";
  // Scramble the filename while decryption is in flight. The ref
  // attaches to the text span below; `text` reruns the animation
  // whenever the target changes (e.g. navigating between files in
  // the same preview modal). Overdrive mode keeps cycling even if
  // the scramble would otherwise finish before the chunk-download
  // completes, so the animation stays visibly "in motion" until we
  // flip loading=false.
  const { ref: scrambleRef } = useScramble({
    text: fileName,
    speed: 0.6,
    tick: 2,
    step: 1,
    scramble: 4,
    chance: 0.7,
    overdrive: true,
    // Digits + punctuation + letters — narrow range so the scramble
    // looks like ciphertext glyphs, not emoji or CJK. 33..122 covers
    // printable ASCII (! through z).
    range: [33, 122],
  });

  if (!fileId) return null;

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
          {/* Radius matches the marketing-page CTAs (8px) so the
              visual language stays consistent between landing and
              app surfaces. Key icon (instead of shield) because the
              credential-under-user-control framing is what this badge
              is actually about — decrypt happens here because you
              hold the key, not the server. */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] bg-white/8 border border-white/10">
            <HugeiconsIcon icon={Key02Icon} size={11} color="rgb(239,90,60)" />
            <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-white/60">
              Decrypted locally
            </span>
          </div>
          {/* Filename: split off the extension into a trailing
              uppercase-mono chip so the name itself reads clean
              and the format tag echoes the "DECRYPTED LOCALLY"
              pill aesthetic. Falls back to just the name when
              there's no extension (folders, extensionless files). */}
          {(() => {
            const dot = fileName.lastIndexOf(".");
            const hasExt = dot > 0 && dot < fileName.length - 1;
            const baseName = hasExt ? fileName.slice(0, dot) : fileName;
            const ext = hasExt ? fileName.slice(dot + 1) : "";
            return (
              <div className="flex items-baseline gap-2 min-w-0 ml-1">
                <span className="text-[14px] font-medium text-white truncate">
                  {baseName}
                </span>
                {ext && (
                  <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-white/40 shrink-0">
                    {ext}
                  </span>
                )}
              </div>
            );
          })()}
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
              // Hover effect uses `filter: brightness` (GPU-composited
              // with no stacking-context reraster) instead of the old
              // `opacity-90`, which flickered when the cursor skimmed
              // the button's edge. Transition is scoped to filter only
              // so layout-affecting properties don't get caught up in
              // the animation.
              className="inline-flex items-center gap-2 h-[32px] px-3.5 rounded-[8px] bg-accent-red text-white text-[11px] font-mono uppercase tracking-[0.1em] hover:brightness-110 transition-[filter] duration-150 cursor-pointer"
            >
              <HugeiconsIcon icon={Download04Icon} size={13} />
              Download
            </button>
          )}
          {/* Close: secondary action next to the red primary.
              Bordered ghost so it reads as interactive without
              competing with Download for attention. Icon sharpens
              and bg lifts on hover; slight active-scale gives the
              same tactile click feedback as the primary. */}
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="inline-flex items-center justify-center w-[32px] h-[32px] rounded-[8px] border border-white/10 text-white/60 hover:text-white hover:bg-white/10 hover:border-white/20 active:scale-[0.96] transition-all cursor-pointer"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} />
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

        {/* Loading — scramble-text "decrypting" animation. The
            filename glyphs cycle through printable-ASCII ciphertext
            and settle into their real characters as the decrypt
            progresses. Tonally honest about what's happening:
            random bytes becoming a real name. */}
        {loading && (
          <div className="flex flex-col items-center gap-5 max-w-[420px] px-6">
            {/* Shield with progress ring around it. The ring fills
                with actual decrypt progress when we have a number
                from the hook; otherwise spins indefinitely. */}
            <div className="relative w-14 h-14">
              <svg
                viewBox="0 0 40 40"
                className={`absolute inset-0 w-full h-full ${decryptProgress === null ? "animate-spin" : ""}`}
                style={decryptProgress === null ? { animationDuration: "2s" } : undefined}
              >
                <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
                <circle
                  cx="20" cy="20" r="17" fill="none"
                  stroke="rgb(239,90,60)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 17 * (decryptProgress !== null ? decryptProgress / 100 : 0.25)} ${2 * Math.PI * 17}`}
                  style={{
                    transform: "rotate(-90deg)",
                    transformOrigin: "center",
                    transition: decryptProgress !== null ? "stroke-dasharray 150ms linear" : undefined,
                  }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <HugeiconsIcon icon={Shield01Icon} size={18} color="rgba(255,255,255,0.75)" />
              </div>
            </div>

            {/* Scrambled filename. Monospace keeps glyph widths
                stable during the scramble so the text doesn't
                jitter horizontally as characters resolve. */}
            <span
              ref={scrambleRef}
              className="font-mono text-[13px] text-white/85 tracking-wide text-center leading-tight break-all"
            />

            <div className="flex items-center gap-2 text-[11px] text-white/40 font-mono uppercase tracking-[0.2em]">
              <span>Decrypting</span>
              {decryptProgress !== null && (
                <span className="text-white/60">{decryptProgress}%</span>
              )}
            </div>
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

        {!loading && preview && preview.type === "application/pdf" && (
          <PdfPreview blobUrl={preview.blobUrl} name={preview.name} />
        )}

        {!loading && preview && isDocxMime(preview.type) && (
          <OfficePreview
            blobUrl={preview.blobUrl}
            name={preview.name}
            kind="docx"
          />
        )}

        {!loading && preview && isXlsxMime(preview.type) && (
          <OfficePreview
            blobUrl={preview.blobUrl}
            name={preview.name}
            kind="xlsx"
          />
        )}

        {/* Text preview — CodePreview lazy-loads highlight.js and
            falls back to plain <pre> for unrecognized extensions. */}
        {!loading && preview && textContent !== null && isText(preview.type) && (
          <CodePreview text={textContent} filename={preview.name} />
        )}

        {/* Unsupported type */}
        {!loading && preview && !isPreviewable(preview.type) && (
          <div className="text-center max-w-[320px]">
            <p className="text-[14px] text-white/70 mb-2">No preview available</p>
            <p className="text-[12px] text-white/40 mb-4">
              {preview.type || "Unknown type"} · {preview.name}
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

/**
 * PDF preview with optional subdomain isolation.
 *
 * When `NEXT_PUBLIC_PDF_VIEWER_ORIGIN` is set at build time (e.g.
 * `https://pdf.securewarp.com`), PDFs render through an iframe at
 * that origin. The iframe hosts `/viewer`, which is a small page
 * that does nothing but accept PDF bytes via postMessage and render
 * them via its own blob URL. A malicious PDF that exploits the
 * viewer can't reach the main app's cookies or storage because the
 * iframe is on a different origin.
 *
 * When the env var is unset (no DNS configured yet, local dev), the
 * component falls back to the same-origin inline iframe — same
 * security posture as before this change, so shipping the code
 * before DNS is wired doesn't regress anything.
 *
 * Neither Chrome's PDFium nor Firefox's PDF.js works with
 * `sandbox` attributes that block scripts (the viewer UI itself
 * needs to run JS), so isolation via origin is the only path to a
 * true cross-domain boundary. See AGENTS.md → "File-preview safety".
 */
function PdfPreview({ blobUrl, name }: { blobUrl: string; name: string }) {
  return (
    <IsolatedPreview
      blobUrl={blobUrl}
      name={name}
      viewerPath="/viewer"
      messageType="pdf-bytes"
      // PDF intentionally omits the iframe `sandbox` attribute. The
      // browser's built-in PDF viewer (Safari/PDFium, Firefox/PDF.js)
      // renders the PDF inside a NESTED blob: iframe within the
      // viewer page. Sandbox flags inherit to nested iframes and
      // prevent the browser-internal viewer from engaging cleanly,
      // leaving a blank panel. Origin isolation + viewer CSP remain
      // in place — those are the load-bearing defenses.
      fallback={
        <iframe
          src={blobUrl}
          title={name}
          className="w-[95vw] h-[90vh] rounded-lg bg-white"
        />
      }
    />
  );
}

/**
 * Isolated Office (.docx, .xlsx) preview.
 *
 * Same isolation pattern as PdfPreview — content renders on
 * pdf.securewarp.com (the dedicated viewer subdomain) so a malicious
 * document that exploits mammoth or exceljs cannot reach main-app
 * cookies, sessionStorage, or APIs. When the subdomain isn't
 * configured (no DNS yet, local dev), there is no safe inline
 * fallback for Office docs, so the preview shows a download prompt.
 */
function OfficePreview({
  blobUrl,
  name,
  kind,
}: {
  blobUrl: string;
  name: string;
  kind: "docx" | "xlsx";
}) {
  return (
    <IsolatedPreview
      blobUrl={blobUrl}
      name={name}
      viewerPath={`/viewer/${kind}`}
      messageType={`${kind}-bytes`}
      // Office viewers render content directly (no nested iframe), so
      // the sandbox doesn't break them and we get its defense in depth.
      sandbox="allow-scripts allow-same-origin"
      fallback={
        <div className="text-center max-w-[320px] text-white/70 text-[13px]">
          Office preview requires the isolated viewer subdomain.
        </div>
      }
    />
  );
}

/**
 * Generic isolated-iframe preview wrapper. Loads
 * `${viewerOrigin}${viewerPath}`, waits for a `viewer-ready`
 * postMessage, then ships the blob bytes across as `messageType`.
 * Falls back to `fallback` if the subdomain isn't configured or the
 * viewer never reports ready within 5s.
 */
function IsolatedPreview({
  blobUrl,
  name,
  viewerPath,
  messageType,
  fallback,
  sandbox,
}: {
  blobUrl: string;
  name: string;
  viewerPath: string;
  messageType: string;
  fallback: React.ReactNode;
  sandbox?: string;
}) {
  const viewerOrigin = process.env.NEXT_PUBLIC_PDF_VIEWER_ORIGIN?.trim();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!viewerOrigin) return;
    let cancelled = false;

    const handler = async (e: MessageEvent) => {
      if (cancelled) return;
      if (e.origin !== viewerOrigin) return;
      if (!e.data || typeof e.data !== "object") return;
      if ((e.data as { type?: unknown }).type !== "viewer-ready") return;
      // viewer-ready means the iframe is alive — cancel the readiness
      // timeout so a slow renderer (mammoth/exceljs) can't trigger the
      // fallback after we've already shipped bytes successfully.
      clearTimeout(timeout);
      let bytes: Uint8Array | null = null;
      try {
        // Re-fetch the blob to get raw bytes. The blob URL is
        // same-origin to the main app, so this is just a memory copy;
        // no network. Transferring the buffer avoids a second copy
        // across the postMessage structured-clone boundary.
        const buf = await (await fetch(blobUrl)).arrayBuffer();
        if (cancelled) return;
        bytes = new Uint8Array(buf);
        iframeRef.current?.contentWindow?.postMessage(
          { type: messageType, bytes },
          viewerOrigin,
          [bytes.buffer]
        );
        // After transfer the underlying ArrayBuffer is detached, so
        // the Uint8Array view is already unreadable. The reference is
        // dropped on function return.
      } catch {
        if (!cancelled) setFailed(true);
        // Best-effort zero on the failure path before GC reclaims it.
        // Per the AGENTS.md crypto rules: typed-array secrets must be
        // .fill(0)'d on every exit path that doesn't transfer them.
        if (bytes) {
          try {
            bytes.fill(0);
          } catch {
            // Buffer was detached by a partial transfer; nothing to do.
          }
        }
      }
    };

    window.addEventListener("message", handler);

    // If the viewer never reports ready (DNS not set up, origin
    // unreachable, Cloudflare challenge in flight), fall back to the
    // parent-supplied fallback. 15s gives a cold first-visit enough
    // budget to: (a) acquire cf_clearance for the pdf subdomain,
    // (b) load the viewer chunk, (c) load the heavy mammoth/exceljs
    // renderer, (d) send the first viewer-ready ping. Observed
    // behaviour on post-login first-preview: 5s was too tight.
    const timeout = setTimeout(() => {
      if (!cancelled) setFailed(true);
    }, 15000);

    return () => {
      cancelled = true;
      window.removeEventListener("message", handler);
      clearTimeout(timeout);
    };
  }, [viewerOrigin, blobUrl, messageType]);

  if (!viewerOrigin || failed) return <>{fallback}</>;

  return (
    <iframe
      ref={iframeRef}
      src={`${viewerOrigin}${viewerPath}`}
      title={name}
      // `sandbox` is opt-in per preview type. Set for Office viewers
      // (defense in depth on top of origin isolation), omitted for
      // PDF where the browser's built-in viewer renders into a
      // nested blob iframe and inherits the sandbox restrictions —
      // that breaks PDFium engagement and leaves a blank panel.
      sandbox={sandbox}
      className="w-[95vw] h-[90vh] rounded-lg bg-white"
    />
  );
}
