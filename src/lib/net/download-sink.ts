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
 * 2. **OPFS (`navigator.storage.getDirectory`)**: Safari (and any browser
 *    that implements OPFS but not `showSaveFilePicker` — currently Firefox
 *    nightly, Safari 16+). We write chunks to a temp file inside the
 *    origin-private filesystem — that's real disk, not heap — then open
 *    the finished file as a `File` object and trigger the anchor-download
 *    path. Heap stays flat at one chunk at a time. After the download is
 *    wired up, we delete the temp file. Without this path, Safari can't
 *    complete a >~1GB download (the one-shot `new Blob([Uint8Array])`
 *    either OOMs or produces a zombie URL that Safari saves as "Unknown").
 *
 * 3. **Blob fallback**: last resort. Accumulates every chunk in a JS array
 *    and concatenates into a single Blob at `close()`. Same memory envelope
 *    as the pre-FSA path. Only fires on browsers with neither FSA nor
 *    OPFS — ancient WebKit and non-evergreen engines. Large downloads on
 *    this path remain capped by tab heap.
 *
 * Ownership contract: once `write(chunk)` resolves, the sink owns `chunk`.
 * Every backend zeros the chunk before returning (either after the disk
 * write, or deferred until close in the blob fallback). Callers must not
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

interface FsaFileHandle {
  createWritable(): Promise<FsaWritable>;
  getFile?(): Promise<File>;
}

interface FsaWindow {
  showSaveFilePicker(opts?: { suggestedName?: string }): Promise<FsaFileHandle>;
}

interface OpfsDirectory {
  getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FsaFileHandle>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
}

interface OpfsStorage {
  getDirectory(): Promise<OpfsDirectory>;
}

function hasFsa(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

function getOpfsStorage(): OpfsStorage | null {
  if (typeof navigator === "undefined") return null;
  const storage = (navigator as unknown as { storage?: OpfsStorage }).storage;
  if (!storage || typeof storage.getDirectory !== "function") return null;
  return storage;
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
      // through to the next backend so the download still lands — better
      // a memory-hungry download than no download at all.
      console.warn("[download-sink] FSA open failed, trying OPFS:", err);
    }
  }

  const storage = getOpfsStorage();
  if (storage) {
    try {
      return await makeOpfsSink(storage, suggestedName, mime);
    } catch (err) {
      // OPFS can fail for quota, storage access policy, or private-mode
      // restrictions. Fall through to the in-memory blob path; smaller
      // downloads still work there.
      console.warn("[download-sink] OPFS open failed, using blob fallback:", err);
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

async function makeOpfsSink(
  storage: OpfsStorage,
  suggestedName: string,
  mime: string,
): Promise<DownloadSink> {
  const dir = await storage.getDirectory();
  // Unique temp name so concurrent downloads don't collide on the same
  // OPFS entry. The name is origin-private (never visible to the user or
  // the server); the suggestedName is what lands in Downloads/.
  const tempName = `sw-dl-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  const handle = await dir.getFileHandle(tempName, { create: true });
  const writable = await handle.createWritable();
  let closed = false;

  const cleanup = async () => {
    try {
      await dir.removeEntry(tempName);
    } catch {
      // Entry may already be gone (e.g. if close() already removed it),
      // or removal is not permitted here. Best-effort.
    }
  };

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
      // Re-open the handle as a File and hand it to an anchor click. The
      // File is backed by the OPFS entry we just wrote; the browser reads
      // it off disk as it saves to the user's Downloads folder, so the
      // tab heap never has to hold the whole thing.
      const file = handle.getFile ? await handle.getFile() : null;
      if (!file) {
        await cleanup();
        throw new Error("OPFS file handle did not expose getFile()");
      }
      // Force a specific MIME so the saved file carries the right type
      // hint without the default octet-stream coercion stripping it in
      // environments that respect it. The existing callers already pass
      // application/octet-stream for download safety (see
      // safeMimeForDownload in mime-safety.ts).
      const blob = mime && file.type !== mime ? file.slice(0, file.size, mime) : file;
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = url;
        a.download = suggestedName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } finally {
        // Defer revoke: Safari in particular drops in-flight large-blob
        // reads if the URL is revoked synchronously after click(). 60s
        // is long enough for the browser to commit the save to disk
        // without keeping the URL registered forever.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        // Remove the OPFS temp entry. Browsers hold their own reference
        // to the File/Blob pair via the object URL, so the download
        // keeps working even after the entry is gone.
        await cleanup();
      }
    },
    async abort(reason) {
      if (closed) return;
      closed = true;
      try {
        await writable.abort(reason);
      } catch {
        // terminal state is fine
      }
      await cleanup();
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
      // merged Uint8Array first (as the pre-2026-04 implementation did)
      // peaks at ~2x the total payload and is the main reason very
      // large downloads OOM on Safari. For sane sizes on browsers that
      // reach this fallback, the Blob assembly is cheap.
      const blob = new Blob(parts as BlobPart[], { type: mime });
      // Blob has captured the part buffers. Zero our copies to reduce
      // the plaintext window — the Blob itself is opaque bytes inside
      // the browser that we can't reach to zero.
      for (const p of parts) p.fill(0);
      parts.length = 0;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Defer revoke — same Safari reason as the OPFS path.
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
