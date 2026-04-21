/**
 * Auth red-team tests — integration-level probes of the attack shapes
 * that actual humans try against auth flows. Lives alongside the
 * coverage-style `api-security.test.ts`; this file is narrower and
 * probes specific bypass scenarios the codebase has already been
 * hardened against.
 *
 * Each block below documents the attacker assumption, the endpoint
 * under test, and what the server must do to refuse the attack.
 *
 * Mocks mirror `api-security.test.ts` — Supabase chain, session, and
 * rate-limit are all mockable per test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Valid v4 UUID literals for the tests. zod's .uuid() rejects non-v4
// version nibbles (pos 14) and non-8/9/a/b variant nibbles (pos 19).
const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const UUID_3 = "33333333-3333-4333-8333-333333333333";
const UUID_4 = "44444444-4444-4444-8444-444444444444";
const UUID_5 = "55555555-5555-4555-8555-555555555555";

// ──────────────────────────────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────────────────────────────

let mockSession: { userId: string; email: string } | null = null;
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(() => Promise.resolve(mockSession)),
  createSession: vi.fn(() => Promise.resolve()),
  revokeAllSessions: vi.fn(() => Promise.resolve()),
}));

let mockRateLimitResult = true;
vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: vi.fn(() => Promise.resolve(mockRateLimitResult)),
  resetRateLimit: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/auth/turnstile", () => ({
  verifyTurnstile: vi.fn(() => Promise.resolve({ ok: true })),
}));

vi.mock("@/lib/audit", () => ({ auditEvent: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/flags", () => ({ getBoolFlag: vi.fn(() => Promise.resolve(true)) }));
vi.mock("@/lib/email/send", () => ({
  sendEmail: vi.fn(() => Promise.resolve({ ok: true })),
}));

// Users DB
const mockUsers = {
  getUserByEmail: vi.fn(),
  getUserById: vi.fn(),
  createUser: vi.fn(),
  updateUserAuth: vi.fn(() => Promise.resolve()),
};
vi.mock("@/lib/db/users", () => mockUsers);

// SRP sessions
const mockSrpSessions = {
  getSrpSession: vi.fn(),
  deleteSrpSession: vi.fn(() => Promise.resolve()),
  createSrpSession: vi.fn(() => Promise.resolve("srp-session-id")),
};
vi.mock("@/lib/db/srp-sessions", () => mockSrpSessions);

// Recovery token consumption
const mockConsumeRecoveryToken = vi.fn();
vi.mock("@/lib/auth/used-tokens", () => ({
  consumeRecoveryToken: mockConsumeRecoveryToken,
}));

// SRP server primitives — we don't simulate real crypto; we just decide
// whether the proof "verifies" or throws.
const mockVerifyClientAndDeriveSession = vi.fn();
const mockGenerateServerEphemeral = vi.fn(() => ({
  serverSecretEphemeral: "s-sec",
  serverPublicEphemeral: "s-pub",
}));
vi.mock("@/lib/srp/server", () => ({
  verifyClientAndDeriveSession: mockVerifyClientAndDeriveSession,
  generateServerEphemeral: mockGenerateServerEphemeral,
}));

// Supabase chain — each test resets all chain methods via makeChain()
// to avoid cross-test corruption from per-test overrides.
type SbResult = { data: unknown; error: unknown };
interface SbChain {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  lt: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
}

function makeChain(): SbChain {
  const chain = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    lt: vi.fn(),
    single: vi.fn(
      (): Promise<SbResult> =>
        Promise.resolve({ data: null, error: { code: "PGRST116" } }),
    ),
  };
  for (const k of ["select", "insert", "update", "delete", "eq", "or", "lt"] as const) {
    (chain[k] as ReturnType<typeof vi.fn>).mockImplementation(() => chain);
  }
  return chain;
}

let chain: SbChain = makeChain();
vi.mock("@/lib/db/supabase", () => ({
  supabase: {
    from: vi.fn(() => chain),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
}));

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function makePost(url: string, body: unknown): Request {
  return new Request(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  });
}

function userWithTotp(email = "alice@example.com") {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    email,
    srp_salt: "salt",
    srp_verifier: "verifier",
    argon2_salt: "argon",
    encrypted_user_data: "enc",
    public_encryption_key: "pek",
    recovery_key_hash: null,
    recovery_encrypted_data: null,
    created_at: new Date().toISOString(),
    totp_secret: "JBSWY3DPEHPK3PXP",
    totp_pending_secret: null,
    totp_last_used_at: null,
    suspended_at: null as string | null,
    suspended_reason: null as string | null,
  };
}

function userNoTotp(email = "alice@example.com") {
  const u = userWithTotp(email);
  u.totp_secret = null as unknown as string;
  return u;
}

beforeEach(async () => {
  mockSession = null;
  mockRateLimitResult = true;
  vi.clearAllMocks();
  // Rebuild the chain so per-test overrides cannot leak to the next test.
  chain = makeChain();
  mockVerifyClientAndDeriveSession.mockReset();
  mockGenerateServerEphemeral.mockReturnValue({
    serverSecretEphemeral: "s-sec",
    serverPublicEphemeral: "s-pub",
  });
  // Restore rate-limit mock — some tests call mockImplementation() which
  // overrides the closure-based default. Reassign each run so flipping
  // `mockRateLimitResult` is always authoritative.
  const rl = await import("@/lib/auth/rate-limit");
  vi.mocked(rl.checkRateLimit).mockImplementation(() =>
    Promise.resolve(mockRateLimitResult),
  );
  vi.mocked(rl.resetRateLimit).mockImplementation(() => Promise.resolve());
});

// ══════════════════════════════════════════════════════════════════════
// 2FA login flow — /api/auth/login/verify-2fa
// ══════════════════════════════════════════════════════════════════════

describe("red-team: 2FA login verify", () => {
  /** Attack: caller guesses an srpSessionId, skipping the SRP step. */
  it("rejects a verify-2fa call with no valid SRP session (401)", async () => {
    mockSrpSessions.getSrpSession.mockResolvedValue(null);
    const mod = await import("@/app/api/auth/login/verify-2fa/route");
    const res = await mod.POST(
      makePost("/api/auth/login/verify-2fa", {
        srpSessionId: UUID_1,
        code: "123456",
      }),
    );
    expect(res.status).toBe(401);
    expect(mockSrpSessions.deleteSrpSession).not.toHaveBeenCalled();
  });

  /** Attack: caller has a real srpSession but tries to call verify-2fa for
   *  an account without TOTP configured — smuggling into 2FA to skip the
   *  regular verify. Must 400. */
  it("rejects verify-2fa on a user with no TOTP secret (400 Invalid state)", async () => {
    mockSrpSessions.getSrpSession.mockResolvedValue({
      id: "s",
      user_id: "u",
      server_secret_ephemeral: "x",
      client_public_ephemeral: "y",
      created_at: "",
      expires_at: "",
    });
    mockUsers.getUserById.mockResolvedValue(userNoTotp());
    const mod = await import("@/app/api/auth/login/verify-2fa/route");
    const res = await mod.POST(
      makePost("/api/auth/login/verify-2fa", {
        srpSessionId: UUID_2,
        code: "123456",
      }),
    );
    expect(res.status).toBe(400);
  });

  /** Attack: spam TOTP guesses. Once rate limit exceeded, SRP session
   *  must be burned so an attacker can't wait out the window and retry. */
  it("burns the SRP session on rate limit exhaustion (429)", async () => {
    mockSrpSessions.getSrpSession.mockResolvedValue({
      id: "s",
      user_id: "u",
      server_secret_ephemeral: "x",
      client_public_ephemeral: "y",
      created_at: "",
      expires_at: "",
    });
    mockUsers.getUserById.mockResolvedValue(userWithTotp());
    mockRateLimitResult = false;

    const mod = await import("@/app/api/auth/login/verify-2fa/route");
    const res = await mod.POST(
      makePost("/api/auth/login/verify-2fa", {
        srpSessionId: UUID_3,
        code: "123456",
      }),
    );
    expect(res.status).toBe(429);
    expect(mockSrpSessions.deleteSrpSession).toHaveBeenCalledWith(UUID_3);
  });

  /** Input validation: non-6-digit codes rejected at parse layer (400). */
  it("rejects malformed code length (400)", async () => {
    const mod = await import("@/app/api/auth/login/verify-2fa/route");
    const res = await mod.POST(
      makePost("/api/auth/login/verify-2fa", {
        srpSessionId: UUID_5,
        code: "12345",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects non-UUID srpSessionId (400)", async () => {
    const mod = await import("@/app/api/auth/login/verify-2fa/route");
    const res = await mod.POST(
      makePost("/api/auth/login/verify-2fa", {
        srpSessionId: "not-a-uuid",
        code: "123456",
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2FA setup — /api/auth/2fa/setup and /verify-setup
// ══════════════════════════════════════════════════════════════════════

describe("red-team: 2FA setup", () => {
  /** Attack: user with 2FA already enabled calls /setup again. Must 409. */
  it("rejects /2fa/setup for a user who already has TOTP (409)", async () => {
    mockSession = { userId: "u", email: "a@x.com" };
    chain.single.mockResolvedValueOnce({
      data: { totp_secret: "ALREADY-ENABLED", email: "a@x.com" },
      error: null,
    });
    const mod = await import("@/app/api/auth/2fa/setup/route");
    const res = await mod.POST();
    expect(res.status).toBe(409);
  });

  /** Attack: stolen session holder calls /setup rapidly. Rate limit fires. */
  it("rate-limits /2fa/setup to prevent pending-secret spam (429)", async () => {
    mockSession = { userId: "u", email: "a@x.com" };
    chain.single.mockResolvedValueOnce({
      data: { totp_secret: null, email: "a@x.com" },
      error: null,
    });
    mockRateLimitResult = false;
    const mod = await import("@/app/api/auth/2fa/setup/route");
    const res = await mod.POST();
    expect(res.status).toBe(429);
  });

  /** Attack: attacker sends their own secret + code to /verify-setup,
   *  hoping to register 2FA under a secret they control. Route reads from
   *  DB — no pending row, 400. */
  it("/2fa/verify-setup reads pending secret from DB, not from request (400 when none)", async () => {
    mockSession = { userId: "u", email: "a@x.com" };
    chain.single.mockResolvedValueOnce({
      data: { totp_pending_secret: null },
      error: null,
    });
    const mod = await import("@/app/api/auth/2fa/verify-setup/route");
    const res = await mod.POST(
      makePost("/api/auth/2fa/verify-setup", { code: "123456" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated /2fa/setup (401)", async () => {
    mockSession = null;
    const mod = await import("@/app/api/auth/2fa/setup/route");
    const res = await mod.POST();
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated /2fa/verify-setup (401)", async () => {
    mockSession = null;
    const mod = await import("@/app/api/auth/2fa/verify-setup/route");
    const res = await mod.POST(
      makePost("/api/auth/2fa/verify-setup", { code: "123456" }),
    );
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SRP login flow — /api/auth/login/init and /verify
// ══════════════════════════════════════════════════════════════════════

describe("red-team: SRP login flow", () => {
  /** Attack: email enumeration via distinct error messages. */
  it("returns the SAME generic error for unknown email as for wrong password", async () => {
    mockUsers.getUserByEmail.mockResolvedValue(null);
    const initMod = await import("@/app/api/auth/login/init/route");
    const initRes = await initMod.POST(
      makePost("/api/auth/login/init", {
        email: "ghost@example.com",
        clientPublicEphemeral: "x",
      }),
    );
    expect(initRes.status).toBe(401);
    const initData = await initRes.json();
    expect(initData.error).toMatch(/invalid email or password/i);

    mockSrpSessions.getSrpSession.mockResolvedValue({
      id: "s",
      user_id: "u",
      server_secret_ephemeral: "x",
      client_public_ephemeral: "y",
      created_at: "",
      expires_at: "",
    });
    mockUsers.getUserById.mockResolvedValue(userNoTotp());
    mockVerifyClientAndDeriveSession.mockImplementation(() => {
      throw new Error("bad proof");
    });
    const verifyMod = await import("@/app/api/auth/login/verify/route");
    const verifyRes = await verifyMod.POST(
      makePost("/api/auth/login/verify", {
        srpSessionId: UUID_1,
        clientProof: "wrong-proof",
      }),
    );
    expect(verifyRes.status).toBe(401);
    const verifyData = await verifyRes.json();
    expect(verifyData.error).toMatch(/invalid email or password/i);
  });

  /** Attack: case-variant email to bypass rate-limit bucket. Route
   *  normalizes before keying, so A@x.com and a@x.com share a bucket. */
  it("rate-limits /login/init using the NORMALIZED email (case-variant cannot bypass)", async () => {
    mockUsers.getUserByEmail.mockResolvedValue(null);
    const rl = await import("@/lib/auth/rate-limit");
    const calls: string[] = [];
    vi.mocked(rl.checkRateLimit).mockImplementation((k: string) => {
      calls.push(k);
      return Promise.resolve(true);
    });

    const mod = await import("@/app/api/auth/login/init/route");
    await mod.POST(
      makePost("/api/auth/login/init", {
        email: "A@Example.com",
        clientPublicEphemeral: "x",
      }),
    );
    await mod.POST(
      makePost("/api/auth/login/init", {
        email: "a@example.com",
        clientPublicEphemeral: "x",
      }),
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
    expect(calls[0]).toBe("login:a@example.com");
  });

  /** Attack: post-SRP-verify, attacker hopes to get a session for a
   *  suspended user. Must 403. */
  it("blocks suspended users at /login/verify (403) — after SRP proof", async () => {
    mockSrpSessions.getSrpSession.mockResolvedValue({
      id: "s",
      user_id: "u",
      server_secret_ephemeral: "x",
      client_public_ephemeral: "y",
      created_at: "",
      expires_at: "",
    });
    const suspended = userNoTotp();
    suspended.suspended_at = new Date().toISOString();
    mockUsers.getUserById.mockResolvedValue(suspended);
    mockVerifyClientAndDeriveSession.mockReturnValue({ serverProof: "ok" });

    const mod = await import("@/app/api/auth/login/verify/route");
    const res = await mod.POST(
      makePost("/api/auth/login/verify", {
        srpSessionId: UUID_2,
        clientProof: "ok",
      }),
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.suspended).toBe(true);
  });

  /** Attack: try to obtain a session for a 2FA-enabled user by stopping
   *  at /verify. The route must withhold session issuance. */
  it("does NOT issue a session for 2FA-enabled user at /login/verify", async () => {
    mockSrpSessions.getSrpSession.mockResolvedValue({
      id: "s",
      user_id: "u",
      server_secret_ephemeral: "x",
      client_public_ephemeral: "y",
      created_at: "",
      expires_at: "",
    });
    mockUsers.getUserById.mockResolvedValue(userWithTotp());
    mockVerifyClientAndDeriveSession.mockReturnValue({ serverProof: "ok" });

    const sessionMod = await import("@/lib/auth/session");

    const mod = await import("@/app/api/auth/login/verify/route");
    const res = await mod.POST(
      makePost("/api/auth/login/verify", {
        srpSessionId: UUID_3,
        clientProof: "ok",
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.requires2FA).toBe(true);
    expect(data.srpSessionId).toBe(UUID_3);
    expect(vi.mocked(sessionMod.createSession)).not.toHaveBeenCalled();
    expect(mockSrpSessions.deleteSrpSession).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════
// Recovery flow — /api/auth/recover
// ══════════════════════════════════════════════════════════════════════

describe("red-team: recovery flow", () => {
  /** Ensure the HS256 signing secret is set for jose. Anything ≥32 chars. */
  beforeEach(() => {
    process.env.SESSION_SECRET =
      "test-secret-must-be-at-least-32-chars-long-yes";
  });

  async function makeRecoveryToken(
    jti: string,
    purpose = "recovery",
  ): Promise<string> {
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
    return await new SignJWT({
      userId: "u",
      email: "a@x.com",
      purpose,
      jti,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(secret);
  }

  /** Attack: recovery token replay. */
  it("rejects a reused recovery token at /recover update (401)", async () => {
    const token = await makeRecoveryToken("jti-1");
    mockConsumeRecoveryToken.mockResolvedValue(false);

    const mod = await import("@/app/api/auth/recover/route");
    const res = await mod.POST(
      makePost("/api/auth/recover", {
        action: "update",
        recoveryToken: token,
        newSrpSalt: "s",
        newSrpVerifier: "v",
        newArgon2Salt: "a",
        newEncryptedUserData: "e",
      }),
    );
    expect(res.status).toBe(401);
    expect(mockUsers.updateUserAuth).not.toHaveBeenCalled();
  });

  /** Attack: valid token, but account was suspended between /verify and
   *  /update. Must NOT let the user back in. */
  it("blocks recovery on suspended account even with valid token (403)", async () => {
    const token = await makeRecoveryToken("jti-2");
    mockConsumeRecoveryToken.mockResolvedValue(true);
    chain.single.mockResolvedValueOnce({
      data: {
        suspended_at: new Date().toISOString(),
        suspended_reason: "abuse",
      },
      error: null,
    });

    const mod = await import("@/app/api/auth/recover/route");
    const res = await mod.POST(
      makePost("/api/auth/recover", {
        action: "update",
        recoveryToken: token,
        newSrpSalt: "s",
        newSrpVerifier: "v",
        newArgon2Salt: "a",
        newEncryptedUserData: "e",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockUsers.updateUserAuth).not.toHaveBeenCalled();
  });

  /** Attack: pick a token with purpose other than "recovery". Must 401. */
  it("rejects a token with wrong purpose claim (401)", async () => {
    const token = await makeRecoveryToken("jti-3", "totally-different");

    const mod = await import("@/app/api/auth/recover/route");
    const res = await mod.POST(
      makePost("/api/auth/recover", {
        action: "update",
        recoveryToken: token,
        newSrpSalt: "s",
        newSrpVerifier: "v",
        newArgon2Salt: "a",
        newEncryptedUserData: "e",
      }),
    );
    expect(res.status).toBe(401);
  });

  /** Lost-phone recovery MUST clear TOTP so the user can sign in after. */
  it("recovery update calls updateUserAuth with clearTotp:true", async () => {
    const token = await makeRecoveryToken("jti-4");
    mockConsumeRecoveryToken.mockResolvedValue(true);
    chain.single.mockResolvedValueOnce({
      data: { suspended_at: null, suspended_reason: null },
      error: null,
    });

    const mod = await import("@/app/api/auth/recover/route");
    const res = await mod.POST(
      makePost("/api/auth/recover", {
        action: "update",
        recoveryToken: token,
        newSrpSalt: "s",
        newSrpVerifier: "v",
        newArgon2Salt: "a",
        newEncryptedUserData: "e",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockUsers.updateUserAuth).toHaveBeenCalledWith(
      "u",
      expect.objectContaining({ clearTotp: true }),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════
// Change password — /api/auth/change-password
// ══════════════════════════════════════════════════════════════════════

describe("red-team: change-password", () => {
  /** Attack: session stealer (XSS, stolen device) tries to change the
   *  password without knowing it. Old SRP verifier check blocks it. */
  it("rejects session stealer who doesn't know old password (403)", async () => {
    mockSession = { userId: "u", email: "a@x.com" };
    mockUsers.getUserById.mockResolvedValue({
      ...userNoTotp(),
      srp_verifier: "real-verifier",
    });

    const mod = await import("@/app/api/auth/change-password/route");
    const res = await mod.POST(
      makePost("/api/auth/change-password", {
        oldSrpVerifier: "attacker-guess",
        newSrpSalt: "s",
        newSrpVerifier: "v",
        newArgon2Salt: "a",
        newEncryptedUserData: "e",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockUsers.updateUserAuth).not.toHaveBeenCalled();
  });

  /** Regression: change-password must NOT clear TOTP. */
  it("change-password preserves TOTP (updateUserAuth without clearTotp)", async () => {
    mockSession = { userId: "u", email: "a@x.com" };
    mockUsers.getUserById.mockResolvedValue({
      ...userWithTotp(),
      srp_verifier: "old-verifier",
    });

    const mod = await import("@/app/api/auth/change-password/route");
    const res = await mod.POST(
      makePost("/api/auth/change-password", {
        oldSrpVerifier: "old-verifier",
        newSrpSalt: "s",
        newSrpVerifier: "v",
        newArgon2Salt: "a",
        newEncryptedUserData: "e",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockUsers.updateUserAuth).toHaveBeenCalled();
    const calls = mockUsers.updateUserAuth.mock.calls as unknown as Array<
      [string, { clearTotp?: boolean }]
    >;
    expect(calls[0][1].clearTotp).toBeUndefined();
  });

  /** Rate limit: 5 attempts to block password-verifier brute force. */
  it("rate-limits /change-password (429)", async () => {
    mockSession = { userId: "u", email: "a@x.com" };
    mockRateLimitResult = false;
    const mod = await import("@/app/api/auth/change-password/route");
    const res = await mod.POST(
      makePost("/api/auth/change-password", {
        oldSrpVerifier: "any",
        newSrpSalt: "s",
        newSrpVerifier: "v",
        newArgon2Salt: "a",
        newEncryptedUserData: "e",
      }),
    );
    expect(res.status).toBe(429);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Registration — /api/auth/register
// ══════════════════════════════════════════════════════════════════════

describe("red-team: register", () => {
  /** Attack: same email with different casing to register twice. Normalizer
   *  at the boundary collapses them. */
  it("rejects case-variant duplicate registration", async () => {
    mockUsers.getUserByEmail.mockResolvedValueOnce(
      userNoTotp("existing@x.com"),
    );
    const mod = await import("@/app/api/auth/register/route");
    const res = await mod.POST(
      makePost("/api/auth/register", {
        email: "Existing@X.COM",
        srpSalt: "s",
        srpVerifier: "v",
        argon2Salt: "a",
        encryptedUserData: { nonce: "n", ciphertext: "c" },
        publicEncryptionKey: "pek",
        publicKemKey: "kek",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockUsers.getUserByEmail).toHaveBeenCalledWith("existing@x.com");
    expect(mockUsers.createUser).not.toHaveBeenCalled();
  });

  /** Regression: generic duplicate-account error — no email enumeration. */
  it("returns a generic duplicate-account error (no email existence leak)", async () => {
    mockUsers.getUserByEmail.mockResolvedValueOnce(
      userNoTotp("existing@x.com"),
    );
    const mod = await import("@/app/api/auth/register/route");
    const res = await mod.POST(
      makePost("/api/auth/register", {
        email: "existing@x.com",
        srpSalt: "s",
        srpVerifier: "v",
        argon2Salt: "a",
        encryptedUserData: { nonce: "n", ciphertext: "c" },
        publicEncryptionKey: "pek",
        publicKemKey: "kek",
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).not.toMatch(/already exists/i);
    expect(data.error).not.toMatch(/taken/i);
    expect(data.error).toMatch(/unable to create/i);
  });

  /** Signups can be paused globally via the `signups_enabled` flag. */
  it("returns 503 when signups are disabled by the feature flag", async () => {
    const flags = await import("@/lib/flags");
    vi.mocked(flags.getBoolFlag).mockResolvedValueOnce(false);
    const mod = await import("@/app/api/auth/register/route");
    const res = await mod.POST(
      makePost("/api/auth/register", {
        email: "new@x.com",
        srpSalt: "s",
        srpVerifier: "v",
        argon2Salt: "a",
        encryptedUserData: { nonce: "n", ciphertext: "c" },
        publicEncryptionKey: "pek",
        publicKemKey: "kek",
      }),
    );
    expect(res.status).toBe(503);
    expect(mockUsers.createUser).not.toHaveBeenCalled();
  });

  /** Rate limit keys on IP to block mass account creation. */
  it("rate-limits /register (429)", async () => {
    mockRateLimitResult = false;
    const mod = await import("@/app/api/auth/register/route");
    const res = await mod.POST(
      makePost("/api/auth/register", {
        email: "new@x.com",
        srpSalt: "s",
        srpVerifier: "v",
        argon2Salt: "a",
        encryptedUserData: { nonce: "n", ciphertext: "c" },
        publicEncryptionKey: "pek",
        publicKemKey: "kek",
      }),
    );
    expect(res.status).toBe(429);
    expect(mockUsers.createUser).not.toHaveBeenCalled();
  });
});
