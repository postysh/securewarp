import { describe, it, expect, vi, beforeEach } from "vitest";

const USER = "00000000-0000-4000-8000-00000000000a";
const FILE = "00000000-0000-4000-8000-0000000000f1";
const GB = 1024 * 1024 * 1024;

let mockUsedRows: { size_bytes: number | null }[] = [];
let mockFileCount = 0;
let mockReplacedSize: number | null = null;

// The quota module issues three query shapes: a list of size_bytes
// (getUsedBytes), a head-count (getFileCount), and a maybeSingle on
// one file (getFileSizeBytes). Distinguish them by terminal call.
const chain = {
  select: vi.fn(() => chain),
  eq: vi.fn(() => chain),
  maybeSingle: vi.fn(() => Promise.resolve({ data: mockReplacedSize === null ? null : { size_bytes: mockReplacedSize }, error: null })),
  then: (resolve: (v: { data: unknown[]; count: number; error: null }) => void) =>
    resolve({ data: mockUsedRows, count: mockFileCount, error: null }),
};
vi.mock("./supabase", () => ({ supabase: { from: vi.fn(() => chain) } }));

vi.mock("@/lib/billing/customers", () => ({
  getEntitlements: vi.fn(() =>
    Promise.resolve({ tierLabel: "Free", storageGB: 20, maxFileSizeBytes: 100 * 1024 * 1024 })
  ),
}));

beforeEach(() => {
  mockUsedRows = [];
  mockFileCount = 0;
  mockReplacedSize = null;
  vi.clearAllMocks();
});

describe("assertWithinQuota", () => {
  it("rejects a single file over the per-file cap", async () => {
    const { assertWithinQuota } = await import("./quota");
    await expect(assertWithinQuota(USER, 101 * 1024 * 1024)).rejects.toMatchObject({ status: 413 });
  });

  it("rejects when used + incoming exceeds the storage cap", async () => {
    const { assertWithinQuota } = await import("./quota");
    mockUsedRows = [{ size_bytes: 20 * GB - 10 }];
    await expect(assertWithinQuota(USER, 11)).rejects.toMatchObject({ status: 413 });
    await expect(assertWithinQuota(USER, 10)).resolves.toBeUndefined();
  });

  it("credits the replaced file's current size at finalize", async () => {
    const { assertWithinQuota } = await import("./quota");
    // Used is 20 GB flat, but 5 GB of that is THIS file's init-time
    // declaration, which the measured size replaces.
    mockUsedRows = [{ size_bytes: 20 * GB }];
    mockReplacedSize = 5 * GB;
    await expect(
      assertWithinQuota(USER, 50 * 1024 * 1024, { replacesFileId: FILE, skipFileCount: true })
    ).resolves.toBeUndefined();
    // Without the credit the same call is over cap.
    await expect(assertWithinQuota(USER, 50 * 1024 * 1024)).rejects.toMatchObject({ status: 413 });
  });

  it("measured size larger than the replaced declaration is still capped", async () => {
    const { assertWithinQuota } = await import("./quota");
    mockUsedRows = [{ size_bytes: 20 * GB }];
    mockReplacedSize = 1; // client declared 1 byte at init
    await expect(
      assertWithinQuota(USER, 90 * 1024 * 1024, { replacesFileId: FILE, skipFileCount: true })
    ).rejects.toMatchObject({ status: 413 });
  });

  it("skipFileCount bypasses only the count guard", async () => {
    const { assertWithinQuota, MAX_FILE_COUNT } = await import("./quota");
    mockFileCount = MAX_FILE_COUNT;
    await expect(assertWithinQuota(USER, 1)).rejects.toMatchObject({ status: 413 });
    await expect(assertWithinQuota(USER, 1, { skipFileCount: true })).resolves.toBeUndefined();
  });
});
