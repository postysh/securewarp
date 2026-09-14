/**
 * Authorization tests for the second batch of sharing-audit fixes:
 *
 *  - /delete: non-owner editors may trash WORKSPACE files only; a
 *    personal-drive file is owner-only.
 *  - /[id]/versions/[versionId] DELETE: evidence hold blocks version
 *    deletion (previously only /delete and /purge checked it).
 *  - revokeLinksCreatedByInSubtree: links the removed user created on
 *    the file or its descendants are revoked; others are untouched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const EDITOR = "00000000-0000-4000-8000-00000000000b";
const FILE = "00000000-0000-4000-8000-0000000000f1";
const VERSION = "00000000-0000-4000-8000-0000000000e1";

let mockSession: { userId: string; email: string } | null = null;
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(() => Promise.resolve(mockSession)),
}));
vi.mock("@/lib/audit", () => ({ auditEvent: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/realtime/broadcast", () => ({
  broadcastFileMutation: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/db/r2", () => ({
  deleteBlobs: vi.fn(() => Promise.resolve()),
}));

let mockOnHold = false;
vi.mock("@/lib/db/trust-safety", () => ({
  isFileOnHold: vi.fn(() => Promise.resolve(mockOnHold)),
  findHeldFileIds: vi.fn(() => Promise.resolve([])),
}));

// `@/lib/db/files` is partially mocked: the route-facing helpers are
// stubbed, but `revokeLinksCreatedByInSubtree` is the real thing so
// it can be exercised against the supabase mock below.
let mockOwned: { id: string; is_workspace_root: boolean } | null = null;
let mockPermission: "owner" | "editor" | "viewer" | null = null;
const trashSubtree = vi.fn(() => Promise.resolve());
const trashSubtreeUnscoped = vi.fn(() => Promise.resolve());
const deleteFileVersion = vi.fn(() => Promise.resolve([]));
vi.mock("@/lib/db/files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/files")>();
  return {
    ...actual,
    getOwnedFile: vi.fn(() => Promise.resolve(mockOwned)),
    getEffectivePermission: vi.fn(() => Promise.resolve(mockPermission)),
    trashSubtree: (...a: unknown[]) => trashSubtree(...(a as [])),
    trashSubtreeUnscoped: (...a: unknown[]) => trashSubtreeUnscoped(...(a as [])),
    getFileById: vi.fn(() => Promise.resolve({ id: FILE, owner_id: OWNER })),
    getFileVersion: vi.fn(() => Promise.resolve({ id: VERSION, file_id: FILE, version_number: 1 })),
    deleteFileVersion: (...a: unknown[]) => deleteFileVersion(...(a as [])),
  };
});

// Minimal supabase mock. `single()` returns whatever the test primes
// for the *files* row; `then` resolves list queries to `mockRows`.
let mockFileRow: Record<string, unknown> | null = null;
let mockRows: unknown[] = [];
const updateSpy = vi.fn();
const chain: Record<string, unknown> = {};
Object.assign(chain, {
  select: vi.fn(() => chain),
  update: vi.fn((patch: unknown) => {
    updateSpy(patch);
    return chain;
  }),
  eq: vi.fn(() => chain),
  in: vi.fn(() => chain),
  is: vi.fn(() => chain),
  not: vi.fn(() => chain),
  single: vi.fn(() => Promise.resolve({ data: mockFileRow, error: mockFileRow ? null : { code: "PGRST116" } })),
  maybeSingle: vi.fn(() => Promise.resolve({ data: mockFileRow, error: null })),
  then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: mockRows, error: null }),
});
vi.mock("@/lib/db/supabase", () => ({
  supabase: { from: vi.fn(() => chain) },
}));

function post(body: unknown): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockSession = { userId: EDITOR, email: "e@example.com" };
  mockOnHold = false;
  mockOwned = null;
  mockPermission = null;
  mockFileRow = null;
  mockRows = [];
  vi.clearAllMocks();
});

describe("POST /api/files/delete — non-owner branch", () => {
  it("refuses a non-owner editor on a personal-drive file", async () => {
    mockPermission = "editor";
    mockFileRow = { id: FILE, is_workspace_root: false, workspace_id: null };
    const { POST } = await import("@/app/api/files/delete/route");
    const res = await POST(post({ fileId: FILE }));
    expect(res.status).toBe(404);
    expect(trashSubtreeUnscoped).not.toHaveBeenCalled();
    expect(trashSubtree).not.toHaveBeenCalled();
  });

  it("lets a workspace editor trash a workspace file", async () => {
    mockPermission = "editor";
    mockFileRow = { id: FILE, is_workspace_root: false, workspace_id: "00000000-0000-4000-8000-0000000000aa" };
    const { POST } = await import("@/app/api/files/delete/route");
    const res = await POST(post({ fileId: FILE }));
    expect(res.status).toBe(200);
    expect(trashSubtreeUnscoped).toHaveBeenCalledWith(FILE);
  });

  it("still refuses viewers", async () => {
    mockPermission = "viewer";
    mockFileRow = { id: FILE, is_workspace_root: false, workspace_id: "00000000-0000-4000-8000-0000000000aa" };
    const { POST } = await import("@/app/api/files/delete/route");
    const res = await POST(post({ fileId: FILE }));
    expect(res.status).toBe(404);
    expect(trashSubtreeUnscoped).not.toHaveBeenCalled();
  });

  it("owner path is unaffected", async () => {
    mockSession = { userId: OWNER, email: "o@example.com" };
    mockOwned = { id: FILE, is_workspace_root: false };
    const { POST } = await import("@/app/api/files/delete/route");
    const res = await POST(post({ fileId: FILE }));
    expect(res.status).toBe(200);
    expect(trashSubtree).toHaveBeenCalledWith(FILE, OWNER);
  });
});

describe("DELETE /api/files/[id]/versions/[versionId] — evidence hold", () => {
  const params = Promise.resolve({ id: FILE, versionId: VERSION });

  it("returns 423 and deletes nothing when the file is on hold", async () => {
    mockSession = { userId: OWNER, email: "o@example.com" };
    mockOnHold = true;
    const { DELETE } = await import("@/app/api/files/[id]/versions/[versionId]/route");
    const res = await DELETE(new Request("http://localhost/api/test", { method: "DELETE" }), { params });
    expect(res.status).toBe(423);
    expect(deleteFileVersion).not.toHaveBeenCalled();
  });

  it("proceeds when not on hold", async () => {
    mockSession = { userId: OWNER, email: "o@example.com" };
    mockOnHold = false;
    // current_version_number differs from the version being deleted
    mockFileRow = { current_version_number: 2 };
    const { DELETE } = await import("@/app/api/files/[id]/versions/[versionId]/route");
    const res = await DELETE(new Request("http://localhost/api/test", { method: "DELETE" }), { params });
    expect(res.status).toBe(200);
    expect(deleteFileVersion).toHaveBeenCalledWith(VERSION);
  });
});

describe("revokeLinksCreatedByInSubtree", () => {
  const CHILD = "00000000-0000-4000-8000-0000000000c1";
  const OTHER = "00000000-0000-4000-8000-0000000000d1";

  it("revokes links on the root and its descendants, leaves unrelated links alone", async () => {
    const files = await import("@/lib/db/files");
    // Active links the user created: one on the root, one on a child,
    // one on an unrelated file.
    mockRows = [
      { id: "l-root", file_id: FILE },
      { id: "l-child", file_id: CHILD },
      { id: "l-other", file_id: OTHER },
    ];
    // isDescendantOf walks parent_id via `single()`. CHILD → FILE;
    // OTHER → null (root of some other tree).
    const single = chain.single as ReturnType<typeof vi.fn>;
    single.mockImplementation(() => {
      // The most recent `.eq("id", x)` call tells us which row is asked for.
      const eqCalls = (chain.eq as ReturnType<typeof vi.fn>).mock.calls;
      const last = eqCalls[eqCalls.length - 1] as unknown as [string, string];
      const id = last?.[1];
      if (id === CHILD) return Promise.resolve({ data: { parent_id: FILE }, error: null });
      if (id === OTHER) return Promise.resolve({ data: { parent_id: null }, error: null });
      return Promise.resolve({ data: null, error: { code: "PGRST116" } });
    });

    const n = await files.revokeLinksCreatedByInSubtree(FILE, EDITOR);
    expect(n).toBe(2);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const inCalls = (chain.in as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, string[]][];
    const revokedIds = inCalls.find((c) => c[0] === "id")?.[1];
    expect(revokedIds).toEqual(["l-root", "l-child"]);
  });

  it("isDescendantOf returns false at a root and throws only on the depth cap", async () => {
    const files = await import("@/lib/db/files");
    const single = chain.single as ReturnType<typeof vi.fn>;
    const eqCalls = chain.eq as ReturnType<typeof vi.fn>;
    // Root-terminated walk: OTHER → null.
    single.mockImplementation(() => {
      const last = eqCalls.mock.calls[eqCalls.mock.calls.length - 1] as unknown as [string, string];
      if (last?.[1] === OTHER) return Promise.resolve({ data: { parent_id: null }, error: null });
      return Promise.resolve({ data: null, error: { code: "PGRST116" } });
    });
    await expect(files.isDescendantOf(FILE, OTHER)).resolves.toBe(false);

    // Cycle: CHILD → CHILD forever. Must throw rather than return false.
    single.mockImplementation(() => Promise.resolve({ data: { parent_id: CHILD }, error: null }));
    await expect(files.isDescendantOf(FILE, CHILD)).rejects.toThrow(/depth cap/);
  });

  it("is a no-op when the user has no active links", async () => {
    const files = await import("@/lib/db/files");
    mockRows = [];
    const n = await files.revokeLinksCreatedByInSubtree(FILE, EDITOR);
    expect(n).toBe(0);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
