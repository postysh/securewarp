/**
 * Authorization tests for the collaborator write routes that gate on
 * effective permission: share, rename, link-create.
 *
 * Regression coverage for the "direct-row viewer bypass": the old
 * `getFileById(...) || getEffectivePermission(...) !== "viewer"` idiom
 * only rejected viewers who had NO direct file_keys row. A viewer with
 * a direct row passed. And `/share` was an unrestricted upsert that let
 * any collaborator rewrite any row — including the owner's.
 *
 * The DB layer is mocked at the `@/lib/db/files` boundary so each case
 * states the caller's effective permission directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const EDITOR = "00000000-0000-4000-8000-00000000000b";
const VIEWER = "00000000-0000-4000-8000-00000000000c";
const RECIPIENT = "00000000-0000-4000-8000-00000000000d";
const FILE = "00000000-0000-4000-8000-0000000000f1";

let mockSession: { userId: string; email: string } | null = null;
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(() => Promise.resolve(mockSession)),
}));
vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("@/lib/audit", () => ({ auditEvent: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/db/notifications", () => ({
  createNotification: vi.fn(),
  resolveActorLabel: vi.fn(() => Promise.resolve("Someone")),
}));
vi.mock("@/lib/realtime/broadcast", () => ({
  broadcast: vi.fn(() => Promise.resolve()),
  broadcastFileMutation: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/realtime/channels", () => ({
  channelForUser: vi.fn((id: string) => `user:${id}`),
}));
vi.mock("@/lib/db/file-access", () => ({
  recordFileAccess: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/db/trust-safety", () => ({
  logUserIp: vi.fn(() => Promise.resolve()),
  extractRequestIp: vi.fn(() => "127.0.0.1"),
}));

// Recipient lookup: RECIPIENT and OWNER both resolve by email.
vi.mock("@/lib/db/users", () => ({
  getPublicUserByEmail: vi.fn((email: string) => {
    if (email === "recipient@example.com") {
      return Promise.resolve({ id: RECIPIENT, email, public_encryption_key: "pk", public_kem_key: "kem" });
    }
    if (email === "owner@example.com") {
      return Promise.resolve({ id: OWNER, email, public_encryption_key: "pk", public_kem_key: "kem" });
    }
    return Promise.resolve(null);
  }),
}));

// The gate under test. Each case sets what the caller's effective
// permission on FILE is; `null` means no access / no such file.
let mockPermission: "owner" | "editor" | "viewer" | null = null;
const grantFileAccess = vi.fn(() => Promise.resolve());
const updateFileMetadata = vi.fn(() => Promise.resolve());
const createLink = vi.fn(() => Promise.resolve({ id: "00000000-0000-4000-8000-0000000000a1" }));
vi.mock("@/lib/db/files", () => ({
  getFileWithEffectivePermission: vi.fn(() =>
    Promise.resolve(
      mockPermission
        ? { file: { id: FILE, owner_id: OWNER, workspace_id: null }, permission: mockPermission }
        : null
    )
  ),
  grantFileAccess: (...args: unknown[]) => grantFileAccess(...(args as [])),
  updateFileMetadata: (...args: unknown[]) => updateFileMetadata(...(args as [])),
  createLink: (...args: unknown[]) => createLink(...(args as [])),
}));

// Supabase: only used by /share for the existing-row probe and by
// /link/create for the workspace-policy probe. `single()` returns
// whatever the test primes.
let mockExistingRow: { user_id: string; permission_level: string } | null = null;
const chain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(() => Promise.resolve({ data: mockExistingRow, error: mockExistingRow ? null : { code: "PGRST116" } })),
};
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

const shareBody = {
  fileId: FILE,
  recipientEmail: "recipient@example.com",
  encryptedPrivateHierarchicalKey: "wrap",
  wrappedByPublicKey: "sender-pk",
};

beforeEach(() => {
  mockSession = null;
  mockPermission = null;
  mockExistingRow = null;
  vi.clearAllMocks();
});

describe("POST /api/files/share", () => {
  it("rejects a viewer even when they hold a direct file_keys row", async () => {
    mockSession = { userId: VIEWER, email: "v@example.com" };
    mockPermission = "viewer";
    const { POST } = await import("@/app/api/files/share/route");
    const res = await POST(post(shareBody));
    expect(res.status).toBe(404);
    expect(grantFileAccess).not.toHaveBeenCalled();
  });

  it("rejects a caller with no access", async () => {
    mockSession = { userId: EDITOR, email: "e@example.com" };
    mockPermission = null;
    const { POST } = await import("@/app/api/files/share/route");
    const res = await POST(post(shareBody));
    expect(res.status).toBe(404);
    expect(grantFileAccess).not.toHaveBeenCalled();
  });

  it("lets an editor grant a NEW collaborator", async () => {
    mockSession = { userId: EDITOR, email: "e@example.com" };
    mockPermission = "editor";
    const { POST } = await import("@/app/api/files/share/route");
    const res = await POST(post({ ...shareBody, permissionLevel: "viewer" }));
    expect(res.status).toBe(200);
    expect(grantFileAccess).toHaveBeenCalledTimes(1);
    expect(grantFileAccess).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: FILE, userId: RECIPIENT, permissionLevel: "viewer" })
    );
  });

  it("never rewrites the owner's row, whoever the caller is", async () => {
    for (const caller of [EDITOR, OWNER]) {
      vi.clearAllMocks();
      mockSession = { userId: caller, email: "x@example.com" };
      mockPermission = caller === OWNER ? "owner" : "editor";
      const { POST } = await import("@/app/api/files/share/route");
      const res = await POST(post({ ...shareBody, recipientEmail: "owner@example.com", permissionLevel: "viewer" }));
      // Owner sharing to self hits the self check; editor hits the owner check.
      expect(res.status).toBe(400);
      expect(grantFileAccess).not.toHaveBeenCalled();
    }
  });

  it("does not let a non-owner overwrite an existing collaborator's row", async () => {
    mockSession = { userId: EDITOR, email: "e@example.com" };
    mockPermission = "editor";
    mockExistingRow = { user_id: RECIPIENT, permission_level: "viewer" };
    const { POST } = await import("@/app/api/files/share/route");
    const res = await POST(post({ ...shareBody, permissionLevel: "editor" }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { alreadyShared?: boolean };
    expect(json.alreadyShared).toBe(true);
    expect(grantFileAccess).not.toHaveBeenCalled();
  });

  it("owner re-share without a level keeps the existing level (no silent promotion)", async () => {
    mockSession = { userId: OWNER, email: "o@example.com" };
    mockPermission = "owner";
    mockExistingRow = { user_id: RECIPIENT, permission_level: "viewer" };
    const { POST } = await import("@/app/api/files/share/route");
    const res = await POST(post(shareBody));
    expect(res.status).toBe(200);
    expect(grantFileAccess).toHaveBeenCalledWith(expect.objectContaining({ permissionLevel: "viewer" }));
  });

  it("owner re-share with an explicit level applies it", async () => {
    mockSession = { userId: OWNER, email: "o@example.com" };
    mockPermission = "owner";
    mockExistingRow = { user_id: RECIPIENT, permission_level: "viewer" };
    const { POST } = await import("@/app/api/files/share/route");
    const res = await POST(post({ ...shareBody, permissionLevel: "editor" }));
    expect(res.status).toBe(200);
    expect(grantFileAccess).toHaveBeenCalledWith(expect.objectContaining({ permissionLevel: "editor" }));
  });
});

describe("POST /api/files/[id]/rename", () => {
  const params = Promise.resolve({ id: FILE });
  const body = { encryptedMetadata: "AAAA" };

  it("rejects a direct-row viewer with 403 and writes nothing", async () => {
    mockSession = { userId: VIEWER, email: "v@example.com" };
    mockPermission = "viewer";
    const { POST } = await import("@/app/api/files/[id]/rename/route");
    const res = await POST(post(body), { params });
    expect(res.status).toBe(403);
    expect(updateFileMetadata).not.toHaveBeenCalled();
  });

  it("404s with no access", async () => {
    mockSession = { userId: VIEWER, email: "v@example.com" };
    mockPermission = null;
    const { POST } = await import("@/app/api/files/[id]/rename/route");
    const res = await POST(post(body), { params });
    expect(res.status).toBe(404);
    expect(updateFileMetadata).not.toHaveBeenCalled();
  });

  it("lets an editor rename", async () => {
    mockSession = { userId: EDITOR, email: "e@example.com" };
    mockPermission = "editor";
    const { POST } = await import("@/app/api/files/[id]/rename/route");
    const res = await POST(post(body), { params });
    expect(res.status).toBe(200);
    expect(updateFileMetadata).toHaveBeenCalledWith(FILE, "AAAA");
  });
});

describe("POST /api/files/link/create", () => {
  const body = { fileId: FILE, encryptedPrivateHierarchicalKey: "wrap", linkKeyNonce: "n" };

  it("rejects a direct-row viewer with 403 and mints nothing", async () => {
    mockSession = { userId: VIEWER, email: "v@example.com" };
    mockPermission = "viewer";
    const { POST } = await import("@/app/api/files/link/create/route");
    const res = await POST(post(body));
    expect(res.status).toBe(403);
    expect(createLink).not.toHaveBeenCalled();
  });

  it("404s with no access", async () => {
    mockSession = { userId: VIEWER, email: "v@example.com" };
    mockPermission = null;
    const { POST } = await import("@/app/api/files/link/create/route");
    const res = await POST(post(body));
    expect(res.status).toBe(404);
    expect(createLink).not.toHaveBeenCalled();
  });

  it("lets an editor create a link", async () => {
    mockSession = { userId: EDITOR, email: "e@example.com" };
    mockPermission = "editor";
    const { POST } = await import("@/app/api/files/link/create/route");
    const res = await POST(post(body));
    expect(res.status).toBe(200);
    expect(createLink).toHaveBeenCalledTimes(1);
  });
});
