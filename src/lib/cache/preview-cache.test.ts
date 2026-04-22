import { describe, it, expect } from "vitest";
import { createPreviewCache } from "./preview-cache";

function blobOf(sizeBytes: number, mime = "application/octet-stream"): Blob {
  // Allocate a typed array of the requested size so blob.size matches.
  return new Blob([new Uint8Array(sizeBytes)], { type: mime });
}

describe("preview-cache", () => {
  it("returns undefined for a miss", () => {
    const cache = createPreviewCache({ budgetBytes: 1024 });
    expect(cache.get("missing")).toBeUndefined();
  });

  it("stores and retrieves an entry", () => {
    const cache = createPreviewCache({ budgetBytes: 1024 });
    const blob = blobOf(100, "image/png");
    cache.set("file-1", { blob, name: "pic.png", mime: "image/png" });

    const got = cache.get("file-1");
    expect(got?.name).toBe("pic.png");
    expect(got?.mime).toBe("image/png");
    expect(got?.blob).toBe(blob);
    expect(got?.size).toBe(100);
  });

  it("tracks total bytes across entries", () => {
    const cache = createPreviewCache({ budgetBytes: 10_000 });
    cache.set("a", { blob: blobOf(100), name: "a", mime: "x" });
    cache.set("b", { blob: blobOf(200), name: "b", mime: "x" });
    expect(cache.stats().entryCount).toBe(2);
    expect(cache.stats().totalBytes).toBe(300);
  });

  it("evicts oldest entry when budget is exceeded", () => {
    const cache = createPreviewCache({ budgetBytes: 300 });
    cache.set("a", { blob: blobOf(100), name: "a", mime: "x" });
    cache.set("b", { blob: blobOf(100), name: "b", mime: "x" });
    cache.set("c", { blob: blobOf(100), name: "c", mime: "x" });
    // All three fit. Add a 4th to force eviction of a.
    cache.set("d", { blob: blobOf(100), name: "d", mime: "x" });

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
    expect(cache.get("d")).toBeDefined();
    expect(cache.stats().totalBytes).toBe(300);
  });

  it("promotes entries to most-recently-used on get", () => {
    const cache = createPreviewCache({ budgetBytes: 300 });
    cache.set("a", { blob: blobOf(100), name: "a", mime: "x" });
    cache.set("b", { blob: blobOf(100), name: "b", mime: "x" });
    cache.set("c", { blob: blobOf(100), name: "c", mime: "x" });

    // Touch a, making b the oldest.
    cache.get("a");

    // Add d — b should evict, not a.
    cache.set("d", { blob: blobOf(100), name: "d", mime: "x" });

    expect(cache.get("a")).toBeDefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBeDefined();
    expect(cache.get("d")).toBeDefined();
  });

  it("skips caching an entry larger than the whole budget", () => {
    const cache = createPreviewCache({ budgetBytes: 500 });
    cache.set("huge", { blob: blobOf(1000), name: "huge", mime: "x" });

    expect(cache.get("huge")).toBeUndefined();
    expect(cache.stats().entryCount).toBe(0);
    expect(cache.stats().totalBytes).toBe(0);
  });

  it("replaces an existing entry without double-counting bytes", () => {
    const cache = createPreviewCache({ budgetBytes: 10_000 });
    cache.set("a", { blob: blobOf(100), name: "a", mime: "x" });
    cache.set("a", { blob: blobOf(200), name: "a2", mime: "x" });

    expect(cache.get("a")?.size).toBe(200);
    expect(cache.stats().entryCount).toBe(1);
    expect(cache.stats().totalBytes).toBe(200);
  });

  it("invalidate removes one entry and updates byte count", () => {
    const cache = createPreviewCache({ budgetBytes: 10_000 });
    cache.set("a", { blob: blobOf(100), name: "a", mime: "x" });
    cache.set("b", { blob: blobOf(200), name: "b", mime: "x" });

    cache.invalidate("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeDefined();
    expect(cache.stats().totalBytes).toBe(200);
  });

  it("invalidate on a missing key is a no-op", () => {
    const cache = createPreviewCache({ budgetBytes: 1024 });
    cache.set("a", { blob: blobOf(100), name: "a", mime: "x" });
    cache.invalidate("nonexistent");
    expect(cache.stats().entryCount).toBe(1);
    expect(cache.stats().totalBytes).toBe(100);
  });

  it("clear removes all entries and zeroes the byte count", () => {
    const cache = createPreviewCache({ budgetBytes: 10_000 });
    cache.set("a", { blob: blobOf(100), name: "a", mime: "x" });
    cache.set("b", { blob: blobOf(200), name: "b", mime: "x" });

    cache.clear();
    expect(cache.stats().entryCount).toBe(0);
    expect(cache.stats().totalBytes).toBe(0);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });
});
