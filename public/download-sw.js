/**
 * Service worker — streaming download proxy (iframe-trigger variant).
 *
 * The earlier anchor-`download`-attribute trigger (19ad10d / 654d78f)
 * didn't work reliably on Safari: anchor clicks are sometimes not
 * routed through the SW fetch handler, so the request hit the network
 * and produced either Next's 404 page or nothing at all. Iframe
 * navigations ARE consistently routed through the SW on every browser
 * that ships SW support, which is the pattern StreamSaver.js (and the
 * E2E-encrypted apps that build on it) use.
 *
 * Flow:
 *   1. Page posts download-init with `id`, filename, mime, and a
 *      MessageChannel port. SW stores the entry + acks.
 *   2. Page injects a hidden iframe pointed at /sw-download/<id>.
 *   3. Browser navigates the iframe; SW's fetch handler matches the
 *      path, deletes the entry from the registry, and answers with a
 *      Response whose body is a ReadableStream + a
 *      Content-Disposition: attachment header. The browser sees
 *      "attachment" and saves the response to disk instead of trying
 *      to render it in the iframe.
 *   4. Page pipes decrypted chunks over the message channel; SW
 *      enqueues each into the stream controller.
 *   5. Page sends `close`; SW closes the controller; browser
 *      finalises the on-disk file.
 *
 * Safety notes:
 *   - Only intercepts paths matching `/sw-download/<uuid>`. Every
 *     other request falls through untouched.
 *   - The SW never sees decryption keys — only already-decrypted
 *     bytes in transit. No zero-knowledge regression.
 *   - Plaintext bytes live briefly in the SW heap while enqueued,
 *     then the browser consumes them during the save. We can't
 *     `.fill(0)` SW-side copies, but the window is short and the SW
 *     is the only path that avoids a giant blob in the page heap on
 *     Safari (the in-page blob fallback OOMs above ~1 GB).
 */

"use strict";

const downloads = new Map();
const DOWNLOAD_PATH_RE = /^\/sw-download\/([a-zA-Z0-9-]+)$/;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
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
      try {
        port.postMessage({ type: "cancelled" });
      } catch {
        // port closed
      }
      // No need to remove from `downloads` here — the fetch handler
      // already deletes when it binds to the stream.
    },
  });

  downloads.set(id, {
    filename: typeof filename === "string" ? filename : "download",
    mime: typeof mime === "string" ? mime : "application/octet-stream",
    stream,
  });

  // Ack so the page knows it's safe to inject the iframe — without
  // this the navigation can race ahead of `downloads.set(...)` and
  // hit the 404 branch below.
  try {
    port.postMessage({ type: "init-ack" });
  } catch {
    // ignore — page may have torn down already
  }

  // CLOSE OVER `streamController` directly. The fetch handler deletes
  // the registry entry the moment the iframe nav matches, so a
  // `downloads.get(id)` lookup here would return undefined for every
  // chunk message and the stream would never receive bytes — Safari
  // would sit at "preparing to download" forever waiting for a body
  // that never arrives. The closure makes the controller reachable
  // independent of the registry.
  port.onmessage = (msg) => {
    const m = msg.data;
    if (!m || !streamController) return;
    if (m.type === "chunk") {
      try {
        streamController.enqueue(m.data);
      } catch {
        // stream errored / closed — drop silently
      }
    } else if (m.type === "close") {
      try {
        streamController.close();
      } catch {
        // already closed
      }
      // Tell the page the SW side is done so its sink.close() can
      // resolve (instead of resolving immediately and lying to the
      // user that a 2.8GB save is finished while the browser is
      // still flushing). Best-effort signal — `streamController.close()`
      // means we won't enqueue any more bytes; the browser still
      // needs a moment to commit them to disk after this.
      try {
        port.postMessage({ type: "drained" });
      } catch {
        // port closed by page
      }
    } else if (m.type === "abort") {
      try {
        streamController.error(new Error("aborted"));
      } catch {
        // already errored
      }
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
    event.respondWith(new Response("Not found", { status: 404 }));
    return;
  }

  // Consume the entry — once the browser has bound to the stream the
  // entry's job is done. The closure below holds a reference so the
  // stream stays live via the Response.
  downloads.delete(id);

  const asciiName = entry.filename.replace(/[^\x20-\x7E]/g, "_");
  const utf8Name = encodeURIComponent(entry.filename);
  const headers = new Headers({
    "Content-Type": entry.mime,
    // Both forms — legacy ASCII filename= for old parsers, RFC 5987
    // filename*= for modern ones. The `attachment` keyword is what
    // tells the browser to save to disk instead of rendering inline
    // (which would just show as an empty iframe).
    "Content-Disposition":
      `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  event.respondWith(new Response(entry.stream, { headers, status: 200 }));
});
