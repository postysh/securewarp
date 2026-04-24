/**
 * Self-unregistering placeholder.
 *
 * Earlier iterations of this file implemented a streaming-download
 * proxy: page → MessageChannel → SW → Response(ReadableStream) so
 * the browser could save multi-GB files without ever materialising
 * the plaintext in the tab heap. The pattern works in theory, but
 * Safari does not reliably route anchor `download` clicks through a
 * service worker, so on Safari the saved file ended up being
 * either Next's 404 HTML (~26 KB) or zero bytes. Reverted.
 *
 * This file stays at the same URL so any browser that already
 * registered the previous SW (from commits 19ad10d / 654d78f) picks
 * up the unregister on its next update check and cleans up. Without
 * it the stale SW would keep claiming the document indefinitely.
 */

"use strict";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.registration.unregister();
      } catch {
        // ignore — registration may already be gone
      }
    })(),
  );
});
