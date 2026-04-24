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
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", {});
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
  });

  describe("Blob fallback", () => {
    it("returns a non-streaming sink when neither FSA nor SW is available", async () => {
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
