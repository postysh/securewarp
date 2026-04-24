/**
 * Download sink — writes a decrypted file to disk.
 *
 * Three backends, tried in order:
 *
 * 1. **FSA (`showSaveFilePicker`)**: Chromium family. Streams chunks
 *    straight to the user's chosen path via FileSystemWritableFileStream.
 *    Zero RAM accumulation. Only path that handles the multi-GB tier
 *    on Chromium without keeping plaintext in tab heap.
 *
 * 2. **Service worker streaming (iframe trigger)**: Safari, Firefox,
 *    any browser with SW support. `public/download-sw.js` intercepts a
 *    same-origin `/sw-download/<id>` URL navigated via a hidden iframe
 *    and answers with a Response whose body is a ReadableStream and
 *    whose Content-Disposition is `attachment`. The browser saves the
 *    streamed response to disk; the page feeds chunks over a
 *    MessageChannel. Multi-GB downloads land without ever sitting in
 *    the tab heap.
 *
 *    Iframe rather than anchor: Safari historically does NOT route
 *    `<a download>` clicks through the SW fetch handler, so the
 *    earlier anchor-trigger version (commits 19ad10d / 654d78f)
 *    silently produced 404 HTML on the user's disk. iframe
 *    navigations ARE routed through the SW on every browser that
 *    ships SW support — same pattern StreamSaver.js uses.
 *
 * 3. **Blob fallback**: last resort. Accumulates every chunk in a JS
 *    array, hands the array directly to `new Blob`, triggers an
 *    anchor click. Memory-bounded by the tab heap; OOMs on multi-GB
 *    files in Safari/Firefox. Only fires when neither FSA nor a
 *    controlling SW is available.
 *
 * Ownership contract: once `write(chunk)` resolves the sink owns
 * `chunk`. Each backend zeros the chunk before returning (the SW path
 * transfers the underlying ArrayBuffer to the worker, which detaches
 * the page-side view — equivalent to zeroing).
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

interface FsaHandle {
  createWritable(): Promise<FsaWritable>;
}

interface FsaWindow {
  showSaveFilePicker(opts?: { suggestedName?: string }): Promise<FsaHandle>;
}

function hasFsa(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

// Lazy SW registration — one shared promise so parallel downloads
// don't race register(). Resolves to the controlling SW or null. We
// deliberately do NOT fall back to `reg.active` — only a controller
// can intercept the iframe navigation.
let swReadyPromise: Promise<ServiceWorker | null> | null = null;

function canUseSw(): boolean {
  if (typeof navigator === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  if (typeof window !== "undefined" && window.isSecureContext === false) return false;
  return true;
}

/**
 * Trigger SW registration eagerly — call on every drive-page mount so
 * by the time the user clicks Download (typically several seconds
 * later) the page has been controlled by the SW long enough that
 * navigator.serviceWorker.controller is non-null with no race.
 */
export function prewarmDownloadSw(): void {
  void ensureSw();
}

async function ensureSw(): Promise<ServiceWorker | null> {
  if (!canUseSw()) return null;
  if (swReadyPromise) return swReadyPromise;

  swReadyPromise = (async () => {
    try {
      await navigator.serviceWorker.register("/download-sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;

      // Wait for the document to be CONTROLLED, not just for an active
      // registration. clients.claim() in the SW's activate handler
      // dispatches `controllerchange` when the document is claimed;
      // only after that does navigator.serviceWorker.controller become
      // non-null and is the SW able to intercept the iframe nav.
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((res) => {
          const t = setTimeout(res, 5_000); // bail-out
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

      return navigator.serviceWorker.controller ?? null;
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

  await ensureSw();
  // Re-check the live controller at click time. If the SW is no
  // longer controlling (page reload mid-flight, eviction, etc.) we
  // MUST NOT trigger the iframe — the navigation would hit the
  // network and the user would save Next's 404 HTML as their file.
  const liveController =
    typeof navigator !== "undefined"
      ? navigator.serviceWorker?.controller ?? null
      : null;
  if (liveController) {
    try {
      return await makeSwSink(liveController, suggestedName, mime);
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
        // terminal state is fine
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

  // Two-phase ack: post init, wait for SW to confirm `downloads.set(id, ...)`,
  // THEN inject the iframe. Without the wait the iframe navigation can
  // beat the SW's message handler and hit the 404 branch.
  const ackWait = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("SW init-ack timeout")),
      5_000,
    );
    channel.port1.onmessage = (msg) => {
      if (msg.data?.type === "init-ack") {
        clearTimeout(timeout);
        // Replace the handler — page doesn't process any further
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

  // Hidden iframe pointed at the SW-intercepted URL. Iframe
  // navigation IS routed through the SW (unlike anchor `download`
  // clicks on Safari), so the SW's fetch handler fires and answers
  // with the streaming Response. The Content-Disposition: attachment
  // header on that response makes the browser save it to disk
  // instead of trying to render it in the iframe.
  const iframe = document.createElement("iframe");
  iframe.hidden = true;
  iframe.style.display = "none";
  iframe.src = `/sw-download/${id}`;
  document.body.appendChild(iframe);

  let closed = false;
  return {
    streaming: true,
    async write(chunk) {
      // Transfer the backing buffer so the SW owns the bytes and the
      // page-side view is detached (length becomes 0). Equivalent to
      // .fill(0) for the zero-hygiene contract and saves a structured-
      // clone copy on each chunk.
      const buf = chunk.buffer;
      channel.port1.postMessage({ type: "chunk", data: chunk }, [buf as ArrayBuffer]);
    },
    async close() {
      if (closed) return;
      closed = true;
      channel.port1.postMessage({ type: "close" });
      // Keep the port + iframe alive long enough for the SW to drain
      // the stream and the browser to commit the file to disk.
      setTimeout(() => {
        try {
          channel.port1.close();
        } catch {
          // ignore
        }
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 30_000);
    },
    async abort() {
      if (closed) return;
      closed = true;
      try {
        channel.port1.postMessage({ type: "abort" });
      } catch {
        // port may already be gone
      }
      try {
        channel.port1.close();
      } catch {
        // ignore
      }
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
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
      // Defer revoke — Safari kills in-flight large-blob reads if the
      // URL is revoked synchronously after click().
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
