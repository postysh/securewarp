"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Isolated PDF viewer page.
 *
 * This page is intended to be served on a dedicated subdomain
 * (e.g. `pdf.securewarp.com`) and embedded as an iframe by the main
 * app. Rendering PDFs through a separate origin means:
 *
 *   - A malicious PDF that exploits the browser's PDF viewer runs
 *     at the subdomain's origin. It cannot read the main app's
 *     cookies (httpOnly session cookie is scoped to the main host),
 *     sessionStorage, or localStorage (also origin-scoped).
 *   - CSP on the subdomain is its own, separate from the main app.
 *   - The postMessage bridge only accepts bytes from the main app's
 *     origin. The main app only postMessages to the subdomain's
 *     origin. Both ends are origin-locked.
 *
 * Bytes flow: main app decrypts the PDF client-side, fetches the
 * decrypted blob to get raw bytes, postMessages them here. This page
 * creates its own blob URL on its own origin and renders via
 * `<iframe>` so the browser's built-in PDF viewer (PDFium / PDF.js)
 * handles rendering. The blob URL is `blob:https://pdf.securewarp.com/...`
 * — same-origin relative to this page, cross-origin to the main app.
 */

// postMessage sources we accept. Must match the main app's origins.
// If you add a new main-app host, update this list.
const ALLOWED_PARENT_ORIGINS = [
  "https://securewarp.com",
  "https://www.securewarp.com",
];

interface PdfMessage {
  type: "pdf-bytes";
  bytes: Uint8Array;
}

function isPdfMessage(data: unknown): data is PdfMessage {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.type === "pdf-bytes" && d.bytes instanceof Uint8Array;
}

export default function ViewerPage() {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    // The page is only meaningful when embedded by the main app
    // (anti-clickjacking — frame-ancestors enforces who may embed).
    // For top-level visits, redirect to the main site so users who
    // type the URL by hand don't hit an opaque blank page. Matches
    // middleware behaviour for every other path on this subdomain.
    if (window.top === window) {
      window.location.replace("https://www.securewarp.com");
      return;
    }

    let bytesReceived = false;
    const handler = (e: MessageEvent) => {
      if (!ALLOWED_PARENT_ORIGINS.includes(e.origin)) return;
      if (!isPdfMessage(e.data)) return;
      bytesReceived = true;
      let copy: Uint8Array | null = null;
      try {
        // Revoke any prior blob URL before issuing a new one — this
        // page is generally single-shot but be safe against reuse.
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        // `e.data.bytes` has type Uint8Array<ArrayBufferLike> under strict
        // TS, but Blob's BlobPart expects Uint8Array<ArrayBuffer>. Copy
        // into a fresh Uint8Array backed by a plain ArrayBuffer.
        copy = new Uint8Array(e.data.bytes);
        const blob = new Blob([copy as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setBlobUrl(url);
      } catch {
        setErrored(true);
      } finally {
        // Zero the typed-array view of the plaintext PDF. The Blob
        // retains its own internal copy that the browser's PDF
        // viewer reads from — we can't reach that — but every view
        // we control gets cleared.
        if (copy) {
          try {
            copy.fill(0);
          } catch {
            // Buffer already detached; nothing to clear.
          }
        }
      }
    };
    window.addEventListener("message", handler);

    // Signal readiness to the parent. postMessage targetOrigin is a
    // security control — we won't use "*". Determine the actual parent
    // origin from document.referrer and only post if it's allowlisted.
    // Iterating the full allowlist would log a Safari console error
    // for every non-matching origin, even though the call is wrapped.
    const parentOrigin = (() => {
      try {
        return new URL(document.referrer).origin;
      } catch {
        return "";
      }
    })();
    // Retry viewer-ready until bytes arrive — closes a race where the
    // iframe hydrates before the parent attaches its message listener
    // (likely on cached subsequent opens).
    // 100 attempts × 150ms ≈ 15s window, matching the parent's
    // readiness timeout. First-visit-after-login pays for Cloudflare
    // challenges on the pdf subdomain.
    let attempts = 0;
    const ping = () => {
      if (bytesReceived || attempts >= 100) {
        clearInterval(pingInterval);
        return;
      }
      attempts++;
      if (!ALLOWED_PARENT_ORIGINS.includes(parentOrigin)) return;
      try {
        window.parent.postMessage({ type: "viewer-ready" }, parentOrigin);
      } catch {
        // Parent's 5s timeout will fall back to inline render.
      }
    };
    ping();
    const pingInterval = setInterval(ping, 150);

    return () => {
      clearInterval(pingInterval);
      window.removeEventListener("message", handler);
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{ margin: 0, padding: 0, height: "100vh", background: "#fff" }}>
      {blobUrl ? (
        <iframe
          src={blobUrl}
          title="PDF preview"
          style={{ width: "100%", height: "100%", border: 0, display: "block" }}
        />
      ) : errored ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "#666",
            fontFamily: "system-ui, -apple-system, sans-serif",
            fontSize: 13,
          }}
        >
          PDF viewer unavailable.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "#666",
            fontFamily: "system-ui, -apple-system, sans-serif",
            fontSize: 13,
          }}
        >
          Loading…
        </div>
      )}
    </div>
  );
}
