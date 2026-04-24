/**
 * Download sink — writes a decrypted file to disk.
 *
 * Two backends:
 * - **Streaming (FSA)**: `showSaveFilePicker` → `FileSystemWritableFileStream`.
 *   Chunks flow straight to disk with no RAM accumulation. Required for the
 *   5 GB / 25 GB paid tiers, since a single plaintext blob of that size
 *   can't live in a browser tab's heap. Chromium-only as of this writing.
 * - **Blob fallback**: accumulates `Uint8Array` refs until `close()`, then
 *   assembles one Blob and triggers a synthetic `<a download>` click.
 *   Memory-bounded by the tab heap; Safari and Firefox use this path
 *   today. Earlier iterations (60a5529, 19ad10d, 654d78f) tried OPFS and
 *   service-worker-streaming alternatives for Safari big-file downloads;
 *   both were unreliable in practice and have been reverted.
 *
 * Ownership contract: once `write(chunk)` resolves, the sink owns `chunk`.
 * The FSA backend zeros it after the disk write; the blob backend retains
 * the reference and zeros it in `close()`/`abort()`. Callers must not
 * reuse or read from `chunk` after awaiting `write()`.
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

/**
 * Trigger cleanup of any previous-version download service worker that
 * may have been registered by 19ad10d / 654d78f. The SW file at
 * /download-sw.js now self-unregisters on activate, so calling
 * navigator.serviceWorker.getRegistrations() and forcing an update is
 * enough to make existing clients pick up the new (unregistering)
 * code. Safe to call repeatedly.
 */
export function prewarmDownloadSw(): void {
  if (typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  void (async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        if (
          reg.active?.scriptURL?.endsWith("/download-sw.js") ||
          reg.installing?.scriptURL?.endsWith("/download-sw.js") ||
          reg.waiting?.scriptURL?.endsWith("/download-sw.js")
        ) {
          // The new SW unregisters itself on activate. Forcing an
          // update makes the browser refetch + re-activate the new
          // (placeholder) version, which then removes the
          // registration.
          try {
            await reg.update();
          } catch {
            // ignore — best-effort cleanup
          }
          try {
            await reg.unregister();
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // SW APIs not available / blocked — nothing to clean up
    }
  })();
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
      // Permission / quota / other FSA-layer failure. Log once and fall
      // through to the blob path so the download still lands — better a
      // memory-hungry download than no download at all.
      console.warn("[download-sink] FSA open failed, using blob fallback:", err);
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
      // why very large downloads OOM on Safari.
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
