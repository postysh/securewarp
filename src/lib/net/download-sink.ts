/**
 * Download sink — writes a decrypted file to disk.
 *
 * Two backends:
 * - **Streaming (FSA)**: `showSaveFilePicker` → `FileSystemWritableFileStream`.
 *   Chunks flow straight to disk with no RAM accumulation. Required for the
 *   5 GB / 25 GB paid tiers, since a single plaintext blob of that size
 *   can't live in a browser tab's heap.
 * - **Blob fallback**: accumulates `Uint8Array` refs until `close()`, then
 *   assembles one Blob and triggers a synthetic `<a download>` click.
 *   Same memory envelope as the pre-FSA path; browsers without FSA
 *   (Firefox, Safari as of this writing) keep working for reasonable-size
 *   files. Large downloads on these browsers remain capped by tab heap.
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
  let totalBytes = 0;
  let closed = false;
  return {
    streaming: false,
    async write(chunk) {
      parts.push(chunk);
      totalBytes += chunk.length;
    },
    async close() {
      if (closed) return;
      closed = true;
      const merged = new Uint8Array(totalBytes);
      let offset = 0;
      for (const p of parts) {
        merged.set(p, offset);
        offset += p.length;
        p.fill(0);
      }
      parts.length = 0;
      const blob = new Blob([merged], { type: mime });
      // Blob has consumed `merged` (browsers copy the buffer into the
      // blob's internal store). Zero our copy; the blob itself is opaque
      // bytes inside the browser that we can't reach to zero.
      merged.fill(0);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    async abort() {
      if (closed) return;
      closed = true;
      for (const p of parts) p.fill(0);
      parts.length = 0;
    },
  };
}
