import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { putChunkWithRetry } from "./chunk-upload";

describe("putChunkWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("succeeds on first attempt if R2 returns 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const refreshUrl = vi.fn();

    await putChunkWithRetry("https://r2/put-1", new Uint8Array([1, 2, 3]), {
      refreshUrl,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshUrl).not.toHaveBeenCalled();
  });

  it("retries on 500 with exponential backoff, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = putChunkWithRetry("https://r2/x", new Uint8Array(), {
      refreshUrl: vi.fn(),
      baseBackoffMs: 10,
    });

    // After 1st 500: sleeps 10 ms
    await vi.advanceTimersByTimeAsync(10);
    // After 2nd 502: sleeps 20 ms
    await vi.advanceTimersByTimeAsync(20);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after maxAttempts on persistent 500", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = putChunkWithRetry("https://r2/x", new Uint8Array(), {
      refreshUrl: vi.fn(),
      baseBackoffMs: 1,
    }).catch((e) => e);

    await vi.runAllTimersAsync();
    const err = await promise;

    expect(err).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refreshes URL once on 403, retries on the new URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 })) // original expired
      .mockResolvedValueOnce(new Response(null, { status: 200 })); // refreshed URL works
    vi.stubGlobal("fetch", fetchMock);
    const refreshUrl = vi.fn().mockResolvedValue("https://r2/refreshed");

    await putChunkWithRetry("https://r2/original", new Uint8Array(), {
      refreshUrl,
    });

    expect(refreshUrl).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://r2/refreshed");
  });

  it("gives up if the refreshed URL also 403s", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 })) // original
      .mockResolvedValueOnce(new Response(null, { status: 403 })); // refreshed
    vi.stubGlobal("fetch", fetchMock);
    const refreshUrl = vi.fn().mockResolvedValue("https://r2/refreshed");

    const promise = putChunkWithRetry("https://r2/original", new Uint8Array(), {
      refreshUrl,
      baseBackoffMs: 1,
    }).catch((e) => e);

    await vi.runAllTimersAsync();
    const err = await promise;

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/403/);
    expect(refreshUrl).toHaveBeenCalledTimes(1);
  });

  it("gives up immediately on 4xx other than 403 — retry won't fix auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const refreshUrl = vi.fn();

    await expect(
      putChunkWithRetry("https://r2/x", new Uint8Array(), {
        refreshUrl,
        baseBackoffMs: 1,
      }),
    ).rejects.toThrow(/400/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshUrl).not.toHaveBeenCalled();
  });

  it("treats 403 as fatal when no refreshUrl is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      putChunkWithRetry("https://r2/x", new Uint8Array(), {
        baseBackoffMs: 1,
      }),
    ).rejects.toThrow(/403/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on network error (fetch throws)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = putChunkWithRetry("https://r2/x", new Uint8Array(), {
      refreshUrl: vi.fn(),
      baseBackoffMs: 1,
    });

    await vi.runAllTimersAsync();
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
