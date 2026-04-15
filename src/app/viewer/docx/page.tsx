"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Isolated .docx viewer page.
 *
 * Same architecture as the PDF viewer (../page.tsx): served on a
 * dedicated subdomain, embedded by the main app as an iframe, accepts
 * raw bytes via postMessage, renders entirely client-side. A malicious
 * .docx that exploits the renderer runs at the subdomain's origin and
 * has no access to the main app's cookies, sessionStorage, or APIs.
 *
 * Mammoth converts the docx into HTML which we inject into a sandboxed
 * surface. Even though .docx has no script primitive, we set the
 * container's contents via `innerHTML` of mammoth's escaped output —
 * which mammoth produces as plain HTML with no inline scripts. The
 * subdomain's own CSP (script-src 'self' 'unsafe-inline') would
 * permit inline scripts if mammoth ever emitted them, so isolation is
 * the load-bearing defense, not parsing.
 */

const ALLOWED_PARENT_ORIGINS = [
  "https://securewarp.com",
  "https://www.securewarp.com",
];

interface DocxMessage {
  type: "docx-bytes";
  bytes: Uint8Array;
}

function isDocxMessage(data: unknown): data is DocxMessage {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.type === "docx-bytes" && d.bytes instanceof Uint8Array;
}

export default function DocxViewerPage() {
  const [html, setHtml] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.top === window) {
      window.location.replace("https://www.securewarp.com");
      return;
    }

    const handler = async (e: MessageEvent) => {
      if (!ALLOWED_PARENT_ORIGINS.includes(e.origin)) return;
      if (!isDocxMessage(e.data)) return;
      try {
        const mammoth = await import("mammoth");
        // Copy bytes into a fresh ArrayBuffer (mammoth's typings expect
        // `ArrayBuffer`, not `ArrayBufferLike`/`SharedArrayBuffer`).
        const copy = new Uint8Array(e.data.bytes);
        const result = await mammoth.convertToHtml({
          arrayBuffer: copy.buffer,
        });
        setHtml(result.value);
      } catch {
        setErrored(true);
      }
    };
    window.addEventListener("message", handler);

    const parentOrigin = (() => {
      try {
        return new URL(document.referrer).origin;
      } catch {
        return "";
      }
    })();
    if (ALLOWED_PARENT_ORIGINS.includes(parentOrigin)) {
      try {
        window.parent.postMessage({ type: "viewer-ready" }, parentOrigin);
      } catch {
        // Parent's 5s readiness timeout falls back to download.
      }
    }

    return () => window.removeEventListener("message", handler);
  }, []);

  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        minHeight: "100vh",
        background: "#fff",
        color: "#1a1a2e",
      }}
    >
      {html ? (
        <div
          ref={containerRef}
          style={{
            maxWidth: 800,
            margin: "0 auto",
            padding: "32px 48px",
            fontFamily:
              "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
            fontSize: 14,
            lineHeight: 1.6,
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : errored ? (
        <Centered>Document viewer unavailable.</Centered>
      ) : (
        <Centered>Loading…</Centered>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        color: "#666",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}
