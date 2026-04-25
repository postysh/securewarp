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
 *    any browser with SW support. `public/download-sw.js` intercepts
 *    `/sw-download/<id>` URLs navigated via a hidden iframe and answers
 *    with a Response whose body is a ReadableStream and whose
 *    Content-Disposition is `attachment`. The browser saves the streamed
 *    response straight to disk; the page feeds chunks over a
 *    MessageChannel. Multi-GB downloads land without ever sitting in
 *    the tab heap. Iframe rather than anchor: Safari does NOT route
 *    `<a download>` clicks through the SW fetch handler.
 *
 * 3. **Blob fallback**: last resort. Hands all chunks at once to
 *    `new Blob` and triggers an anchor click. Memory-bounded by tab
 *    heap; OOMs on multi-GB files in Safari/Firefox. The
 *    `BLOB_FALLBACK_SIZE_LIMIT` guard refuses to use this path for
 *    files larger than the limit so the user gets a clear error
 *    instead of a silent OOM mid-download.
 *
 * Ownership contract: once `write(chunk)` resolves the sink owns
 * `chunk`. The FSA backend zeros after the disk write; the SW backend
 * transfers the underlying ArrayBuffer (which detaches the page-side
 * view, equivalent to zeroing); the blob backend zeros at close().
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

/**
 * Thrown by `openDownloadSink` when the only available path is the
 * in-memory blob fallback AND the file is large enough that the blob
 * assembly will OOM the tab. The orchestrator should surface a clear
 * "this browser can't download files this large — use Chrome" error
 * instead of fetching gigabytes only to fail at the end.
 */
/**
 * Thrown when the browser cancels an in-flight SW download (the user
 * hit cancel in the download tray, the disk filled, the tab was
 * closed, etc.). The SW dispatches a `cancel` event on the response
 * stream which we forward to the page via the message channel; the
 * sink's `write` and `close` then throw this so the orchestrator
 * stops feeding chunks AND knows to mark the queue row "cancelled"
 * rather than the previous (incorrect) "done".
 */
export class DownloadCancelledByBrowser extends Error {
  constructor(reason?: string) {
    super(reason || "Download cancelled by the browser");
    this.name = "DownloadCancelledByBrowser";
  }
}

export class BrowserCannotStreamLargeDownload extends Error {
  readonly suggestedName: string;
  readonly sizeBytes: number;
  readonly limitBytes: number;
  constructor(suggestedName: string, sizeBytes: number, limitBytes: number) {
    super(
      `This browser can't download files larger than ${(limitBytes / 1_073_741_824).toFixed(1)} GB. ` +
        `Use Chrome, Edge, or Brave for "${suggestedName}".`,
    );
    this.name = "BrowserCannotStreamLargeDownload";
    this.suggestedName = suggestedName;
    this.sizeBytes = sizeBytes;
    this.limitBytes = limitBytes;
  }
}

/**
 * Hard ceiling for the in-memory blob fallback. Above this we refuse
 * to start the download — the assembly would OOM the tab. Picked at
 * 1.5 GB to give Safari a safety margin (single-tab heap is typically
 * 4 GB on 64-bit macOS, but the parts array + the Blob's internal
 * copy effectively double the working set). FSA + SW paths have no
 * such limit.
 */
export const BLOB_FALLBACK_SIZE_LIMIT = 1_500_000_000;

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
let swControllerChangeHooked = false;

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

/**
 * Listen once for `controllerchange` events that NULL the controller
 * (browser evicted the SW under memory pressure). When that happens,
 * blow the cached `swReadyPromise` so the next download call
 * re-registers from scratch instead of using a dead controller. The
 * live re-check in `openDownloadSink` already protects against this,
 * but resetting the cache also unblocks recovery without a tab reload.
 */
function hookSwControllerChange(): void {
  if (swControllerChangeHooked) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  swControllerChangeHooked = true;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!navigator.serviceWorker.controller) {
      swReadyPromise = null;
    }
  });
}

async function ensureSw(): Promise<ServiceWorker | null> {
  if (!canUseSw()) return null;
  hookSwControllerChange();
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

/**
 * Open the right sink for the current browser + file size.
 *
 * @param suggestedName  Filename the browser will use in the save dialog.
 * @param mime           MIME type for the Blob / Response. Should be
 *                       `application/octet-stream` from `safeMimeForDownload`
 *                       so middle-click middle-buttons don't inline-render.
 * @param sizeBytes      File size if known. Used to refuse the blob fallback
 *                       above `BLOB_FALLBACK_SIZE_LIMIT` so the user gets a
 *                       clear error instead of a silent OOM. Pass 0 if
 *                       unknown — the size guard is then skipped.
 *
 * @throws DownloadCancelled       — user dismissed the FSA save picker.
 * @throws BrowserCannotStreamLargeDownload — only blob path available
 *         and `sizeBytes` exceeds the limit.
 */
export async function openDownloadSink(
  suggestedName: string,
  mime: string,
  sizeBytes: number = 0,
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

  // Last resort. Refuse the blob path for files we know will OOM
  // before we fetch a single byte — much better than failing 90%
  // through a 2.8 GB download.
  if (sizeBytes > 0 && sizeBytes > BLOB_FALLBACK_SIZE_LIMIT) {
    throw new BrowserCannotStreamLargeDownload(
      suggestedName,
      sizeBytes,
      BLOB_FALLBACK_SIZE_LIMIT,
    );
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
  let initAcked = false;
  let drainResolve: (() => void) | null = null;
  const drainWait = new Promise<void>((res) => {
    drainResolve = res;
  });
  // Flipped when the SW posts `cancelled` (browser cancel — user
  // cancel in the download tray, disk full, etc.). `write()` and
  // `close()` consult this so the orchestrator surfaces an error
  // instead of marking the queue row "done" while half a file sits
  // on disk. We also resolve drainWait in the cancel branch so
  // close() doesn't hang on its safety timeout.
  let browserCancelled = false;

  const ackWait = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("SW init-ack timeout")),
      5_000,
    );
    channel.port1.onmessage = (msg) => {
      const t = msg.data?.type;
      if (t === "init-ack" && !initAcked) {
        initAcked = true;
        clearTimeout(timeout);
        resolve();
      } else if (t === "drained") {
        // SW has called streamController.close() and (best effort)
        // the browser has consumed everything we enqueued. The
        // sink.close() promise that's awaiting this resolves so the
        // orchestrator can mark the row truly done.
        if (drainResolve) drainResolve();
      } else if (t === "cancelled") {
        // Browser cancelled the download (user cancel, disk full).
        // Latch the flag so the next write()/close() call throws
        // DownloadCancelledByBrowser, AND resolve drainWait so
        // close() doesn't sit on its 10s safety timeout when we
        // already know the destination stream is gone.
        browserCancelled = true;
        if (drainResolve) drainResolve();
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
      if (browserCancelled) {
        // Destination stream is gone — don't burn cycles enqueueing
        // bytes the SW will silently drop. Zero our copy and bail
        // so the orchestrator's catch path tears the rest down.
        chunk.fill(0);
        throw new DownloadCancelledByBrowser();
      }
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

      // Wait for the SW to ack drain (it sends `{ type: "drained" }`
      // after streamController.close() runs). The browser may still
      // need a moment to commit the bytes to disk after that signal,
      // but `drained` is the strongest "done" signal we have without
      // polling the file system. 10s safety timeout keeps the
      // orchestrator unstuck if the SW gets evicted.
      await Promise.race([
        drainWait,
        new Promise<void>((res) => setTimeout(res, 10_000)),
      ]);

      // Tear down the iframe + port. We hold for a few extra seconds
      // after `drained` because some browsers (Safari) keep reading
      // from the SW response stream for a moment after the controller
      // closes — removing the iframe too early can truncate the file.
      setTimeout(() => {
        try {
          channel.port1.close();
        } catch {
          // ignore
        }
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 10_000);

      // If the browser cancelled the destination stream while we
      // were writing (or even after the for-loop finished but before
      // close() ran), drainWait may have resolved cleanly and the
      // SW may have acked drain on a dead stream. Throw here so the
      // orchestrator marks the queue row as cancelled instead of
      // claiming a partial file is "done."
      if (browserCancelled) {
        throw new DownloadCancelledByBrowser();
      }
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
