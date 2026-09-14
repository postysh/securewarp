/**
 * Authorization test for `GET /api/files/list?trash=true&workspaceId=…`.
 *
 * Regression coverage: the workspace-trash branch used to pass the
 * query-string workspaceId straight to `getTrashedForUser`, which
 * returns every trashed row in that workspace regardless of owner and
 * with no membership check. A removed member could keep reading the
 * workspace's trash forever.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const USER = "00000000-0000-4000-8000-00000000000a";
const WORKSPACE = "00000000-0000-4000-8000-0000000000aa";

let mockSession: { userId: string; email: string } | null = null;
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(() => Promise.resolve(mockSession)),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/db/file-access", () => ({
  recordFileAccess: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/http/etag", () => ({
  respondWithETag: vi.fn((_req: Request, body: unknown) => Response.json(body)),
}));

const getTrashedForUser = vi.fn(() => Promise.resolve([]));
vi.mock("@/lib/db/files", () => ({
  getFilesForUser: vi.fn(() => Promise.resolve({ files: [], nextCursor: null })),
  getSharedWithUser: vi.fn(() => Promise.resolve([])),
  getCollaboratorsBulk: vi.fn(() => Promise.resolve(new Map())),
  getInheritedChildren: vi.fn(() => Promise.resolve([])),
  getTrashedForUser: (...args: unknown[]) => getTrashedForUser(...(args as [])),
  getStarredForUser: vi.fn(() => Promise.resolve([])),
  getRecentForUser: vi.fn(() => Promise.resolve([])),
  getAllAccessibleFiles: vi.fn(() => Promise.resolve([])),
  getEffectivePermission: vi.fn(() => Promise.resolve(null)),
}));

// Supabase: the only query this test exercises is the
// workspace_members membership probe (`maybeSingle`). Everything else
// the route might touch on the enrichment path resolves to empty.
let mockMembership: { role: string } | null = null;
const chain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  single: vi.fn(() => Promise.resolve({ data: null, error: { code: "PGRST116" } })),
  maybeSingle: vi.fn(() => Promise.resolve({ data: mockMembership, error: null })),
  then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null }),
};
vi.mock("@/lib/db/supabase", () => ({
  supabase: { from: vi.fn(() => chain) },
}));

function get(query: string): Request {
  return new Request(`http://localhost/api/files/list?${query}`, { method: "GET" });
}

beforeEach(() => {
  mockSession = { userId: USER, email: "u@example.com" };
  mockMembership = null;
  vi.clearAllMocks();
});

describe("GET /api/files/list?trash=true&workspaceId", () => {
  it("404s for a non-member and never queries the workspace trash", async () => {
    const { GET } = await import("@/app/api/files/list/route");
    const res = await GET(get(`trash=true&workspaceId=${WORKSPACE}`));
    expect(res.status).toBe(404);
    expect(getTrashedForUser).not.toHaveBeenCalled();
  });

  it("404s for a malformed workspace id", async () => {
    mockMembership = { role: "admin" };
    const { GET } = await import("@/app/api/files/list/route");
    const res = await GET(get("trash=true&workspaceId=not-a-uuid"));
    expect(res.status).toBe(404);
    expect(getTrashedForUser).not.toHaveBeenCalled();
  });

  it("serves the workspace trash to a member", async () => {
    mockMembership = { role: "viewer" };
    const { GET } = await import("@/app/api/files/list/route");
    const res = await GET(get(`trash=true&workspaceId=${WORKSPACE}`));
    expect(res.status).toBe(200);
    expect(getTrashedForUser).toHaveBeenCalledWith(USER, WORKSPACE);
  });

  it("personal trash needs no membership probe", async () => {
    const { GET } = await import("@/app/api/files/list/route");
    const res = await GET(get("trash=true"));
    expect(res.status).toBe(200);
    expect(chain.maybeSingle).not.toHaveBeenCalled();
    expect(getTrashedForUser).toHaveBeenCalledWith(USER, null);
  });
});
