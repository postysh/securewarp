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

    let bytesReceived = false;
    const handler = async (e: MessageEvent) => {
      if (!ALLOWED_PARENT_ORIGINS.includes(e.origin)) return;
      if (!isDocxMessage(e.data)) return;
      bytesReceived = true;
      let copy: Uint8Array | null = null;
      try {
        const [mammoth, { default: DOMPurify }] = await Promise.all([
          import("mammoth"),
          import("dompurify"),
        ]);
        // Copy bytes into a fresh ArrayBuffer (mammoth's typings expect
        // `ArrayBuffer`, not `ArrayBufferLike`/`SharedArrayBuffer`).
        copy = new Uint8Array(e.data.bytes);
        const result = await mammoth.convertToHtml({
          arrayBuffer: copy.buffer as ArrayBuffer,
        });
        // Belt-and-suspenders. .docx has no script primitive and we're
        // already isolated to this subdomain — but mammoth's HTML
        // output is built from untrusted input, so strip <script>,
        // event handlers, and javascript: URIs before injecting.
        const sanitized = DOMPurify.sanitize(result.value, {
          USE_PROFILES: { html: true },
        });
        setHtml(sanitized);
      } catch {
        setErrored(true);
      } finally {
        // Zero the plaintext bytes once mammoth has parsed them.
        // Mammoth holds its own internal copies we can't reach, but
        // every typed-array secret we control gets cleared.
        if (copy) {
          try {
            copy.fill(0);
          } catch {
            // Already detached; nothing to clear.
          }
        }
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

    // Retry viewer-ready until bytes arrive. If the iframe hydrates
    // before the parent's message listener attaches (cache hits make
    // this likely on subsequent opens), a single post is missed and
    // the parent's 5s timeout fires the fallback. A short retry loop
    // closes the race.
    // 100 attempts × 150ms ≈ 15s window, matching the parent's
    // readiness timeout. First-visit-after-login pays for Cloudflare
    // challenges on the pdf subdomain AND a cold mammoth bundle.
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
        // Parent's 5s timeout will fall back if nothing arrives.
      }
    };
    ping();
    const pingInterval = setInterval(ping, 150);

    return () => {
      clearInterval(pingInterval);
      window.removeEventListener("message", handler);
    };
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
