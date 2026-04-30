/**
 * Passkey route tests — covers the auth/authz/lockout-guard logic.
 * The actual WebAuthn ceremony is exercised by @simplewebauthn/server's
 * own test suite; here we assert the SecureWarp-side gates that wrap
 * around it (session required, last-second-factor lockout, ownership
 * checks, foreign-credential rejection).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock session ───
let mockSession: { userId: string; email: string } | null = null;
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(() => Promise.resolve(mockSession)),
  createSession: vi.fn(() => Promise.resolve(undefined)),
}));

// ─── Mock rate limit (always allow unless overridden) ───
let mockRateLimitResult = true;
vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: vi.fn(() => Promise.resolve(mockRateLimitResult)),
  resetRateLimit: vi.fn(() => Promise.resolve(undefined)),
}));

// ─── Mock supabase with table-keyed handlers ───
type Handler = () => unknown;
const tableHandlers: Record<string, Handler> = {};

function makeChain(table: string) {
  const handler = tableHandlers[table];
  // Each chain method returns `this` (the same proxy) until a
  // terminator (single, then) resolves with the handler's value.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proxy: any = {};
  const passthrough = [
    "select",
    "insert",
    "update",
    "delete",
    "upsert",
    "eq",
    "neq",
    "in",
    "is",
    "not",
    "lt",
    "order",
    "limit",
  ];
  for (const m of passthrough) proxy[m] = vi.fn(() => proxy);
  proxy.single = vi.fn(() => Promise.resolve(handler ? handler() : { data: null, error: null }));
  proxy.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(handler ? handler() : { data: null, error: null }).then(resolve);
  return proxy;
}

vi.mock("@/lib/db/supabase", () => ({
  supabase: {
    from: vi.fn((t: string) => makeChain(t)),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
}));

// ─── Mock audit + log (no-op) ───
vi.mock("@/lib/audit", () => ({ auditEvent: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

// ─── Mock @simplewebauthn/server so route logic can be exercised
//     without crypto setup. Each test overrides the return as needed.
const mockGenerateRegistrationOptions = vi.fn();
const mockVerifyRegistrationResponse = vi.fn();
const mockGenerateAuthenticationOptions = vi.fn();
const mockVerifyAuthenticationResponse = vi.fn();
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: (
    o: unknown,
  ) => mockGenerateRegistrationOptions(o),
  verifyRegistrationResponse: (
    o: unknown,
  ) => mockVerifyRegistrationResponse(o),
  generateAuthenticationOptions: (
    o: unknown,
  ) => mockGenerateAuthenticationOptions(o),
  verifyAuthenticationResponse: (
    o: unknown,
  ) => mockVerifyAuthenticationResponse(o),
}));

// ─── Mock the challenge token helpers so we can trivially round-trip
//     a known challenge without exercising jose's signing path.
let mockChallengeFromToken: string | null = "test-challenge";
vi.mock("@/lib/auth/passkey-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/passkey-server")>(
    "@/lib/auth/passkey-server",
  );
  return {
    ...actual,
    signChallengeToken: vi.fn(() => Promise.resolve("signed-token")),
    verifyChallengeToken: vi.fn(() => Promise.resolve(mockChallengeFromToken)),
  };
});

beforeEach(() => {
  mockSession = null;
  mockRateLimitResult = true;
  mockChallengeFromToken = "test-challenge";
  for (const k of Object.keys(tableHandlers)) delete tableHandlers[k];
  mockGenerateRegistrationOptions.mockReset();
  mockVerifyRegistrationResponse.mockReset();
  mockGenerateAuthenticationOptions.mockReset();
  mockVerifyAuthenticationResponse.mockReset();
  vi.clearAllMocks();
});

// Need SESSION_SECRET for jose import side effects.
process.env.SESSION_SECRET = "test-secret-thats-32-characters!!";

// Build a fake host header so getRpConfig() doesn't NPE.
function req(body?: unknown, host = "localhost:3000"): Request {
  return new Request("http://localhost:3000/test", {
    method: "POST",
    headers: { host, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/auth/passkey/register-options", () => {
  it("rejects unauthenticated callers with 401", async () => {
    mockSession = null;
    const { POST } = await import("./register-options/route");
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  it("rate-limits with 429", async () => {
    mockSession = { userId: "u1", email: "e@x.com" };
    mockRateLimitResult = false;
    const { POST } = await import("./register-options/route");
    const res = await POST(req());
    expect(res.status).toBe(429);
  });
});

describe("POST /api/auth/passkey/register-verify", () => {
  it("rejects unauthenticated callers with 401", async () => {
    mockSession = null;
    const { POST } = await import("./register-verify/route");
    const res = await POST(req({}));
    expect(res.status).toBe(401);
  });

  it("rejects missing fields with 400", async () => {
    mockSession = { userId: "u1", email: "e@x.com" };
    const { POST } = await import("./register-verify/route");
    const res = await POST(req({ nickname: "x" }));
    expect(res.status).toBe(400);
  });

  it("rejects expired/invalid challenge with 400", async () => {
    mockSession = { userId: "u1", email: "e@x.com" };
    mockChallengeFromToken = null;
    const { POST } = await import("./register-verify/route");
    const res = await POST(
      req({
        attestationResponse: {},
        challengeToken: "x",
        prfSalt: "s",
        wrappedUserData: "ct",
        wrappedUserDataNonce: "n",
        nickname: "Mac",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/passkey/login-verify", () => {
  it("rejects missing assertion id with 400", async () => {
    const { POST } = await import("./login-verify/route");
    const res = await POST(
      req({ assertionResponse: {}, challengeToken: "x" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 for unknown credential", async () => {
    tableHandlers["user_passkeys"] = () => ({
      data: null,
      error: { code: "PGRST116" },
    });
    const { POST } = await import("./login-verify/route");
    const res = await POST(
      req({
        assertionResponse: { id: "some-cred-id" },
        challengeToken: "x",
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/auth/passkey/[id]", () => {
  const validId = "12345678-1234-4234-8234-123456789012";

  function deleteReq() {
    return new Request("http://localhost:3000/test", { method: "DELETE" });
  }
  function ctx() {
    return { params: Promise.resolve({ id: validId }) };
  }

  it("rejects unauthenticated callers with 401", async () => {
    mockSession = null;
    const { DELETE } = await import("./[id]/route");
    const res = await DELETE(deleteReq(), ctx());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the passkey doesn't belong to this user", async () => {
    mockSession = { userId: "u1", email: "e@x.com" };
    tableHandlers["user_passkeys"] = () => ({ data: null, error: null });
    const { DELETE } = await import("./[id]/route");
    const res = await DELETE(deleteReq(), ctx());
    expect(res.status).toBe(404);
  });

  it("returns 409 when removing the user's last passkey with no TOTP", async () => {
    mockSession = { userId: "u1", email: "e@x.com" };
    let firstLookup = true;
    tableHandlers["user_passkeys"] = () => {
      if (firstLookup) {
        firstLookup = false;
        return { data: { id: validId, nickname: "Mac" }, error: null };
      }
      // Subsequent count() call.
      return { data: null, error: null, count: 1 };
    };
    tableHandlers["users"] = () => ({
      data: { totp_secret: null },
      error: null,
    });
    const { DELETE } = await import("./[id]/route");
    const res = await DELETE(deleteReq(), ctx());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("last_factor");
  });
});
