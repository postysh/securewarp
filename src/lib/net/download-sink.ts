/**
 * Download sink — writes a decrypted file to disk.
 *
 * Three backends, tried in order:
 *
 * 1. **FSA (`showSaveFilePicker`)**: Chromium family. Streams chunks straight
 *    to the user's chosen disk path via `FileSystemWritableFileStream`. Zero
 *    RAM accumulation. The only path that can land a multi-GB download
 *    without ever materialising the plaintext in the tab heap.
 *
 * 2. **Service worker streaming**: Safari / Firefox / any other browser
 *    with SW support. `public/download-sw.js` intercepts a same-origin
 *    `/sw-download/<id>` request and responds with a `ReadableStream`
 *    whose chunks are fed over a `MessageChannel` from this file. The
 *    browser saves the stream as if it were a normal attachment download,
 *    so multi-GB files land without ever sitting in the page heap as one
 *    blob. This replaces the earlier OPFS attempt — Safari's main-thread
 *    `FileSystemWritableFileStream` implementation didn't reliably flush
 *    writes on `close()`, which produced zero-byte downloads.
 *
 * 3. **Blob fallback**: last resort for environments without FSA or a
 *    usable SW (insecure contexts, private browsing with SW disabled,
 *    test harnesses). Accumulates every chunk in a JS array and
 *    concatenates into a single Blob at `close()`. Same memory envelope
 *    as the pre-SW path.
 *
 * Ownership contract: once `write(chunk)` resolves, the sink owns `chunk`.
 * Every backend zeros the chunk before returning (either after the disk
 * write, or deferred until close in the blob fallback). The SW sink
 * *transfers* the underlying ArrayBuffer to the worker, which detaches
 * the page-side view and is equivalent to zeroing.
 */

export interface DownloadSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
  /** True iff streaming to disk (no RAM accumulation). */
  readonly streaming: boolean;
}

export class DownloadCancelled extends Error {
  constructor() {
    super("Download cancelled by user");
    this.name = "DownloadCancelled";
  }
}

interface FsaWritable {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

interface FsaFileHandle {
  createWritable(): Promise<FsaWritable>;
}

interface FsaWindow {
  showSaveFilePicker(opts?: { suggestedName?: string }): Promise<FsaFileHandle>;
}

function hasFsa(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

// Lazy SW registration — one promise shared across all download attempts,
// so parallel downloads don't race `register()` and cancel each other.
let swReadyPromise: Promise<ServiceWorker | null> | null = null;

function canUseSw(): boolean {
  if (typeof navigator === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  // Secure-context requirement: service workers refuse to register over
  // plain http except on localhost.
  if (typeof window !== "undefined" && window.isSecureContext === false) return false;
  return true;
}

async function ensureSw(): Promise<ServiceWorker | null> {
  if (!canUseSw()) return null;
  if (swReadyPromise) return swReadyPromise;

  swReadyPromise = (async () => {
    try {
      // Scope "/" — SW lives at the origin root so it can intercept
      // `/sw-download/*` regardless of which page initiated the download.
      const reg = await navigator.serviceWorker.register("/download-sw.js", {
        scope: "/",
      });
      // `ready` resolves to the active registration; if we just
      // installed for the first time, activate has already fired
      // because the SW calls self.skipWaiting().
      await navigator.serviceWorker.ready;

      // If this page isn't yet controlled by the SW (first-ever visit
      // after a fresh install), clients.claim() in the SW's activate
      // handler dispatches a `controllerchange` event. Wait for it.
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((res) => {
          const t = setTimeout(res, 3_000); // bail-out
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => {
              clearTimeout(t);
              res();
            },
            { once: true },
          );
        });
      }

      return (
        navigator.serviceWorker.controller ?? reg.active ?? null
      );
    } catch (err) {
      console.warn("[download-sink] SW registration failed:", err);
      return null;
    }
  })();

  return swReadyPromise;
}

export async function openDownloadSink(
  suggestedName: string,
  mime: string,
): Promise<DownloadSink> {
  if (hasFsa()) {
    try {
      const handle = await (window as unknown as FsaWindow).showSaveFilePicker({
        suggestedName,
      });
      const writable = await handle.createWritable();
      return makeFsaSink(writable);
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError") {
        throw new DownloadCancelled();
      }
      console.warn("[download-sink] FSA open failed, trying SW:", err);
    }
  }

  const sw = await ensureSw();
  if (sw) {
    try {
      return await makeSwSink(sw, suggestedName, mime);
    } catch (err) {
      console.warn("[download-sink] SW sink setup failed, using blob fallback:", err);
    }
  }

  return makeBlobSink(suggestedName, mime);
}

function makeFsaSink(writable: FsaWritable): DownloadSink {
  let closed = false;
  return {
    streaming: true,
    async write(chunk) {
      try {
        await writable.write(chunk);
      } finally {
        chunk.fill(0);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await writable.close();
    },
    async abort(reason) {
      if (closed) return;
      closed = true;
      try {
        await writable.abort(reason);
      } catch {
        // abort() can reject if the writable is already in a terminal
        // state; we've done what we can.
      }
    },
  };
}

async function makeSwSink(
  sw: ServiceWorker,
  suggestedName: string,
  mime: string,
): Promise<DownloadSink> {
  const id = cryptoRandomId();
  const channel = new MessageChannel();

  // Await the SW's init-ack BEFORE triggering the fetch. Without the
  // handshake the anchor click below could race ahead of the SW's
  // `downloads.set(id, ...)` call, at which point the fetch handler
  // 404s and the user sees nothing.
  const ackWait = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("SW init-ack timeout")),
      5_000,
    );
    channel.port1.onmessage = (msg) => {
      if (msg.data?.type === "init-ack") {
        clearTimeout(timeout);
        // Replace the handler — the rest of the exchange is
        // page → SW only; the page doesn't process any more
        // messages from the SW on this port.
        channel.port1.onmessage = null;
        resolve();
      }
    };
  });

  sw.postMessage(
    {
      type: "download-init",
      id,
      filename: suggestedName,
      mime,
    },
    [channel.port2],
  );
  channel.port1.start();

  await ackWait;

  // Trigger the browser-initiated fetch for /sw-download/<id>. The SW
  // intercepts it and responds with a streaming Response carrying
  // Content-Disposition: attachment, so the browser saves it to disk
  // without navigating the page. Use an anchor rather than an iframe:
  // iframes with `src=/sw-download/<id>` inherit the page's CSP and
  // on Safari can block the SW-intercepted response. An anchor with
  // `download` dispatches reliably to Downloads.
  const a = document.createElement("a");
  a.href = `/sw-download/${id}`;
  a.download = suggestedName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 1_000);

  let closed = false;
  return {
    streaming: true,
    async write(chunk) {
      // Transfer the backing buffer so the SW owns the bytes and the
      // page-side view is detached (length becomes 0). This is
      // equivalent to .fill(0) for the zero-hygiene contract and
      // avoids a structured-clone copy of a 8MB buffer per chunk.
      const buf = chunk.buffer;
      channel.port1.postMessage({ type: "chunk", data: chunk }, [buf as ArrayBuffer]);
    },
    async close() {
      if (closed) return;
      closed = true;
      channel.port1.postMessage({ type: "close" });
      // Keep the port open long enough for the SW to drain the stream;
      // closing immediately can race the last enqueue on slow machines.
      setTimeout(() => channel.port1.close(), 5_000);
    },
    async abort() {
      if (closed) return;
      closed = true;
      try {
        channel.port1.postMessage({ type: "abort" });
      } catch {
        // Port may already be gone.
      }
      channel.port1.close();
    },
  };
}

function makeBlobSink(suggestedName: string, mime: string): DownloadSink {
  const parts: Uint8Array[] = [];
  let closed = false;
  return {
    streaming: false,
    async write(chunk) {
      parts.push(chunk);
    },
    async close() {
      if (closed) return;
      closed = true;
      // Pass parts directly — the Blob constructor accepts an array of
      // BufferSources and stitches them internally. Allocating a single
      // merged Uint8Array first peaks at ~2x the total payload and is
      // the main reason very large downloads OOM on browsers that
      // reach this path.
      const blob = new Blob(parts as BlobPart[], { type: mime });
      for (const p of parts) p.fill(0);
      parts.length = 0;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Defer the revoke — Safari kills in-flight large-blob reads if
      // the URL is revoked synchronously after click().
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    async abort() {
      if (closed) return;
      closed = true;
      for (const p of parts) p.fill(0);
      parts.length = 0;
    },
  };
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
