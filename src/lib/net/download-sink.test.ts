import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openDownloadSink, DownloadCancelled } from "./download-sink";

// Minimal FSA mocks — shape matches what the sink consumes.
interface FakeWritable {
  write: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
}

function makeWritable(): FakeWritable {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
  };
}

function installFsa(writable: FakeWritable) {
  const handle = { createWritable: vi.fn().mockResolvedValue(writable) };
  const showSaveFilePicker = vi.fn().mockResolvedValue(handle);
  vi.stubGlobal("window", { showSaveFilePicker });
  // Also mask navigator.storage so we don't accidentally hit the OPFS
  // path if the test runtime happens to expose it.
  vi.stubGlobal("navigator", {});
  return { showSaveFilePicker, handle };
}

function installFsaCancel() {
  const err = Object.assign(new Error("User cancelled"), { name: "AbortError" });
  const showSaveFilePicker = vi.fn().mockRejectedValue(err);
  vi.stubGlobal("window", { showSaveFilePicker });
  vi.stubGlobal("navigator", {});
  return { showSaveFilePicker };
}

function installNoFsa() {
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", {});
}

interface FakeOpfsWritable extends FakeWritable {}
interface FakeOpfsHandle {
  createWritable: ReturnType<typeof vi.fn>;
  getFile: ReturnType<typeof vi.fn>;
}
interface FakeOpfsDirectory {
  getFileHandle: ReturnType<typeof vi.fn>;
  removeEntry: ReturnType<typeof vi.fn>;
}

function installOpfs(
  writable: FakeOpfsWritable,
  file: File = new File([new Uint8Array([1, 2, 3, 4])], "tmp"),
) {
  const handle: FakeOpfsHandle = {
    createWritable: vi.fn().mockResolvedValue(writable),
    getFile: vi.fn().mockResolvedValue(file),
  };
  const dir: FakeOpfsDirectory = {
    getFileHandle: vi.fn().mockResolvedValue(handle),
    removeEntry: vi.fn().mockResolvedValue(undefined),
  };
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", {
    storage: { getDirectory: vi.fn().mockResolvedValue(dir) },
  });
  return { handle, dir, file };
}

describe("openDownloadSink", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("FSA path", () => {
    it("prompts the save picker with the suggested name and returns a streaming sink", async () => {
      const writable = makeWritable();
      const { showSaveFilePicker } = installFsa(writable);

      const sink = await openDownloadSink("video.mp4", "application/octet-stream");

      expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: "video.mp4" });
      expect(sink.streaming).toBe(true);
    });

    it("writes chunks through to the FSA writable and zeros the source after write", async () => {
      const writable = makeWritable();
      installFsa(writable);

      const sink = await openDownloadSink("f", "application/octet-stream");
      const chunk = new Uint8Array([1, 2, 3, 4]);
      await sink.write(chunk);

      expect(writable.write).toHaveBeenCalledTimes(1);
      // Zeroed after write resolves
      expect(Array.from(chunk)).toEqual([0, 0, 0, 0]);
    });

    it("zeros the chunk even if the underlying write throws", async () => {
      const writable = makeWritable();
      writable.write.mockRejectedValueOnce(new Error("disk full"));
      installFsa(writable);

      const sink = await openDownloadSink("f", "application/octet-stream");
      const chunk = new Uint8Array([9, 9, 9]);
      await expect(sink.write(chunk)).rejects.toThrow("disk full");
      expect(Array.from(chunk)).toEqual([0, 0, 0]);
    });

    it("close() commits the writable once; further close() is a no-op", async () => {
      const writable = makeWritable();
      installFsa(writable);

      const sink = await openDownloadSink("f", "application/octet-stream");
      await sink.close();
      await sink.close();

      expect(writable.close).toHaveBeenCalledTimes(1);
    });

    it("abort() discards the partial file; further abort/close are no-ops", async () => {
      const writable = makeWritable();
      installFsa(writable);

      const sink = await openDownloadSink("f", "application/octet-stream");
      await sink.abort(new Error("boom"));
      await sink.abort();
      await sink.close();

      expect(writable.abort).toHaveBeenCalledTimes(1);
      expect(writable.close).not.toHaveBeenCalled();
    });

    it("swallows errors thrown by the underlying abort()", async () => {
      const writable = makeWritable();
      writable.abort.mockRejectedValueOnce(new Error("already closed"));
      installFsa(writable);

      const sink = await openDownloadSink("f", "application/octet-stream");
      // Must not reject — the caller is already in an error path.
      await expect(sink.abort()).resolves.toBeUndefined();
    });

    it("throws DownloadCancelled when the user dismisses the save picker", async () => {
      installFsaCancel();

      await expect(
        openDownloadSink("f", "application/octet-stream"),
      ).rejects.toBeInstanceOf(DownloadCancelled);
    });

    it("falls back to blob sink when FSA throws a non-AbortError and OPFS is unavailable", async () => {
      const showSaveFilePicker = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("denied"), { name: "SecurityError" }));
      vi.stubGlobal("window", { showSaveFilePicker, document: globalThis.document });
      vi.stubGlobal("navigator", {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const sink = await openDownloadSink("f", "application/octet-stream");
      expect(sink.streaming).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe("OPFS path", () => {
    it("returns a streaming sink when showSaveFilePicker is absent but OPFS is present", async () => {
      const writable = makeWritable();
      installOpfs(writable);
      const sink = await openDownloadSink("f", "application/octet-stream");
      expect(sink.streaming).toBe(true);
    });

    it("writes chunks through to the OPFS writable and zeros the source after write", async () => {
      const writable = makeWritable();
      installOpfs(writable);

      const sink = await openDownloadSink("f", "application/octet-stream");
      const chunk = new Uint8Array([5, 6, 7]);
      await sink.write(chunk);

      expect(writable.write).toHaveBeenCalledTimes(1);
      expect(Array.from(chunk)).toEqual([0, 0, 0]);
    });

    it("close() finalizes the writable, triggers an anchor click with the File, and removes the OPFS temp entry", async () => {
      vi.useFakeTimers();
      const writable = makeWritable();
      const { dir } = installOpfs(writable);

      const clickSpy = vi.fn();
      const anchor = {
        set href(_v: string) {},
        set download(_v: string) {},
        click: clickSpy,
      } as unknown as HTMLAnchorElement;
      const createElement = vi.fn().mockReturnValue(anchor);
      const appendChild = vi.fn();
      const removeChild = vi.fn();
      vi.stubGlobal("document", {
        createElement,
        body: { appendChild, removeChild },
      });
      const createObjectURL = vi.fn().mockReturnValue("blob:opfs");
      const revokeObjectURL = vi.fn();
      vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

      const sink = await openDownloadSink("out.bin", "application/octet-stream");
      await sink.close();

      expect(writable.close).toHaveBeenCalledTimes(1);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(appendChild).toHaveBeenCalledTimes(1);
      expect(removeChild).toHaveBeenCalledTimes(1);
      // OPFS entry deleted after the anchor download is wired up.
      expect(dir.removeEntry).toHaveBeenCalledTimes(1);
      // revokeObjectURL is deferred — not called synchronously.
      expect(revokeObjectURL).not.toHaveBeenCalled();
      // After the 60s timer fires it finally runs.
      vi.advanceTimersByTime(60_000);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:opfs");
    });

    it("abort() aborts the OPFS writable and removes the temp entry", async () => {
      const writable = makeWritable();
      const { dir } = installOpfs(writable);

      const sink = await openDownloadSink("f", "application/octet-stream");
      await sink.abort(new Error("user cancel"));

      expect(writable.abort).toHaveBeenCalledTimes(1);
      expect(dir.removeEntry).toHaveBeenCalledTimes(1);
    });

    it("falls through to the blob sink when OPFS setup throws", async () => {
      vi.stubGlobal("window", {});
      vi.stubGlobal("navigator", {
        storage: {
          getDirectory: vi.fn().mockRejectedValue(new Error("quota")),
        },
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const sink = await openDownloadSink("f", "application/octet-stream");
      expect(sink.streaming).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe("Blob fallback", () => {
    it("returns a non-streaming sink when neither FSA nor OPFS is available", async () => {
      installNoFsa();
      const sink = await openDownloadSink("f", "application/octet-stream");
      expect(sink.streaming).toBe(false);
    });

    it("retains chunk references across write() and does NOT zero on write", async () => {
      installNoFsa();
      const sink = await openDownloadSink("f", "application/octet-stream");

      const chunk = new Uint8Array([1, 2, 3]);
      await sink.write(chunk);
      // Blob sink owns the buffer but hasn't zeroed yet — close() will.
      expect(Array.from(chunk)).toEqual([1, 2, 3]);
    });

    it("abort() zeros any staged chunks and drops them without triggering a download", async () => {
      installNoFsa();
      const clickSpy = vi.fn();
      const removeChildSpy = vi.fn();
      const anchor = {
        set href(_v: string) {},
        set download(_v: string) {},
        click: clickSpy,
      } as unknown as HTMLAnchorElement;
      vi.stubGlobal("document", {
        createElement: vi.fn().mockReturnValue(anchor),
        body: { appendChild: vi.fn(), removeChild: removeChildSpy },
      });
      vi.stubGlobal("URL", {
        createObjectURL: vi.fn().mockReturnValue("blob:fake"),
        revokeObjectURL: vi.fn(),
      });

      const sink = await openDownloadSink("f", "application/octet-stream");
      const chunk = new Uint8Array([7, 8, 9]);
      await sink.write(chunk);
      await sink.abort();

      expect(Array.from(chunk)).toEqual([0, 0, 0]);
      expect(clickSpy).not.toHaveBeenCalled();
    });

    it("close() assembles chunks, triggers an anchor click, and defers the blob URL revoke", async () => {
      vi.useFakeTimers();
      installNoFsa();
      const clickSpy = vi.fn();
      const anchor = {
        set href(_v: string) {},
        set download(_v: string) {},
        click: clickSpy,
      } as unknown as HTMLAnchorElement;
      const appendChild = vi.fn();
      const removeChild = vi.fn();
      const createElement = vi.fn().mockReturnValue(anchor);
      vi.stubGlobal("document", {
        createElement,
        body: { appendChild, removeChild },
      });
      const createObjectURL = vi.fn().mockReturnValue("blob:fake");
      const revokeObjectURL = vi.fn();
      vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

      const sink = await openDownloadSink("merged.bin", "application/octet-stream");
      await sink.write(new Uint8Array([1, 2]));
      await sink.write(new Uint8Array([3, 4]));
      await sink.close();

      expect(createElement).toHaveBeenCalledWith("a");
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(appendChild).toHaveBeenCalledTimes(1);
      expect(removeChild).toHaveBeenCalledTimes(1);
      expect(createObjectURL).toHaveBeenCalledTimes(1);

      // Revoke is deferred — not called synchronously.
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(60_000);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");

      // Blob should contain exactly the concatenated bytes.
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe("application/octet-stream");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
    });
  });
});
