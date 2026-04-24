/**
 * Service Worker — streaming download proxy.
 *
 * Purpose: let the browser save a multi-GB decrypted file without ever
 * materialising the plaintext in the tab heap. FileSystemAccess API
 * (`showSaveFilePicker`) solves this natively on Chromium, but Safari
 * and Firefox don't ship it. The pre-2026-04 fallback concatenated every
 * chunk into a single in-memory Blob, which peaks at ~2x the payload
 * and OOMs Safari above ~1GB (saves a zero-byte file named "Unknown").
 *
 * This SW gives us a streaming equivalent everywhere:
 *
 *   1. Page creates a MessageChannel and posts
 *      `{ type: "download-init", id, filename, mime }` to the SW,
 *      transferring `port2`.
 *   2. Page triggers the browser to fetch `/sw-download/<id>` (via
 *      a hidden anchor click — same-origin request so the SW
 *      intercepts it).
 *   3. SW's fetch handler matches the path, looks up the entry, and
 *      responds with a `Response(ReadableStream, { headers: {
 *      Content-Disposition: attachment; filename=... } })`. The
 *      browser starts saving to the user's Downloads folder,
 *      reading from the stream as data arrives.
 *   4. Page pipes decrypted chunks to the SW via `port.postMessage
 *      ({ type: "chunk", data: Uint8Array })`. The SW enqueues each
 *      one into the stream controller.
 *   5. Page sends `{ type: "close" }` when done; SW closes the stream
 *      controller; browser finalises the download.
 *
 * Safety notes:
 *   - Scope is `/` (this file lives at the origin root), so the SW
 *     controls the whole app. Only URLs matching `/sw-download/<uuid>`
 *     are intercepted; all other requests pass through untouched.
 *   - The SW never sees the decryption keys — only already-decrypted
 *     bytes in transit to disk. No zero-knowledge regression.
 *   - Plaintext bytes live briefly in the SW heap while enqueued, then
 *     the browser consumes them during the save. Can't `.fill(0)` SW-
 *     side copies, but the window is short and the SW is the only path
 *     that avoids a giant blob in the page heap — strictly better
 *     than the blob-fallback.
 *   - The `filename` header encoding uses RFC 5987's `filename*=UTF-8''`
 *     so non-ASCII names land intact on browsers that honour it.
 */

"use strict";

const downloads = new Map();
const DOWNLOAD_PATH_RE = /^\/sw-download\/([a-zA-Z0-9-]+)$/;

self.addEventListener("install", () => {
  // skipWaiting so the SW takes over immediately on first-load
  // registration; without it, the first download attempt on a brand-
  // new visit would miss the fetch interception.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // clients.claim() so the page that registered us becomes controlled
  // by this SW before the first download is attempted.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "download-init") return;

  const { id, filename, mime } = data;
  const port = event.ports && event.ports[0];
  if (!port || typeof id !== "string") return;

  let streamController;
  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
    },
    cancel() {
      // Browser cancelled the download (user cancelled, tab closed,
      // disk full). Tell the page so it can stop pumping chunks.
      try {
        port.postMessage({ type: "cancelled" });
      } catch {
        // Port may already be closed.
      }
      downloads.delete(id);
    },
  });

  downloads.set(id, {
    filename: typeof filename === "string" ? filename : "download",
    mime: typeof mime === "string" ? mime : "application/octet-stream",
    stream,
    controller: streamController,
    port,
  });

  // Ack back to the page so it can safely trigger the fetch without
  // racing this handler. Without the ack the page might click the
  // download anchor before `downloads.set(...)` has executed, at
  // which point the fetch handler below 404s.
  try {
    port.postMessage({ type: "init-ack" });
  } catch {
    // Port already closed — caller will see the download never starts
    // and time out client-side.
  }

  port.onmessage = (msg) => {
    const entry = downloads.get(id);
    if (!entry) return;
    const m = msg.data;
    if (!m) return;
    if (m.type === "chunk") {
      try {
        entry.controller.enqueue(m.data);
      } catch {
        // Stream already closed / errored.
      }
    } else if (m.type === "close") {
      try {
        entry.controller.close();
      } catch {
        // Already closed.
      }
    } else if (m.type === "abort") {
      try {
        entry.controller.error(new Error("aborted"));
      } catch {
        // Already errored.
      }
      downloads.delete(id);
    }
  };
  port.start();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const match = DOWNLOAD_PATH_RE.exec(url.pathname);
  if (!match) return;

  const id = match[1];
  const entry = downloads.get(id);
  if (!entry) {
    // Stale or unregistered id — return a normal 404 so the browser
    // shows a graceful error rather than the SW hanging forever.
    event.respondWith(new Response("Not found", { status: 404 }));
    return;
  }

  // Consume the entry — once the browser has bound to the stream, the
  // entry's job is done. We keep a reference on the closure below so
  // the stream stays alive via the Response.
  downloads.delete(id);

  const asciiName = entry.filename.replace(/[^\x20-\x7E]/g, "_");
  const utf8Name = encodeURIComponent(entry.filename);
  const headers = new Headers({
    "Content-Type": entry.mime,
    // Both forms — legacy ASCII filename= for old parsers, RFC 5987
    // filename*= for modern ones that prefer it.
    "Content-Disposition":
      `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
    // No Content-Length (streaming), no cache (per-request data),
    // no sniff (the bytes are opaque application/octet-stream).
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  event.respondWith(new Response(entry.stream, { headers, status: 200 }));
});
