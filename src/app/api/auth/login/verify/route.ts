import { NextResponse } from "next/server";
import { LoginVerifySchema } from "@/lib/validators/auth";
import { getUserById } from "@/lib/db/users";
import { getSrpSession, deleteSrpSession } from "@/lib/db/srp-sessions";
import { verifyClientAndDeriveSession } from "@/lib/srp/server";
import { createSession } from "@/lib/auth/session";
import { resetRateLimit } from "@/lib/auth/rate-limit";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = LoginVerifySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid verification data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { srpSessionId, clientProof } = parsed.data;

    // Retrieve ephemeral session
    const srpSession = await getSrpSession(srpSessionId);
    if (!srpSession) {
      return NextResponse.json(
        { error: "Session expired or invalid" },
        { status: 401 }
      );
    }

    // Get user
    const user = await getUserById(srpSession.user_id);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 401 }
      );
    }

    // Verify client proof and derive server proof
    let serverProof: string;
    try {
      const result = verifyClientAndDeriveSession(
        srpSession.server_secret_ephemeral,
        srpSession.client_public_ephemeral,
        user.srp_salt,
        user.srp_verifier,
        clientProof
      );
      serverProof = result.serverProof;
    } catch {
      auditEvent({
        event: "auth.login.fail",
        actorUserId: user.id,
        detail: "srp_proof_mismatch",
      });
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // NOTE: the SRP session is NOT deleted here yet. If 2FA is enabled
    // we need it to persist for the verify-2fa follow-up. It's deleted
    // either in the non-2FA path below or in /login/verify-2fa after
    // the TOTP check succeeds. Orphaned sessions expire via TTL.

    // Suspension check — deliberately AFTER the SRP proof verifies so we
    // don't expose account-state to unauthenticated callers (no email
    // enumeration). A caller who reaches this point already proved they
    // know the password, so revealing "suspended" is fine.
    if (user.suspended_at) {
      auditEvent({
        event: "auth.login.fail",
        actorUserId: user.id,
        detail: "suspended",
      });
      return NextResponse.json(
        {
          error: "Account suspended",
          suspended: true,
          reason: user.suspended_reason ?? null,
        },
        { status: 403 }
      );
    }

    // ── 2FA gate ───────────────────────────────────────────────────
    // If the user has TOTP enabled, don't issue a session yet. Return
    // the SRP server proof + encrypted data so the client can verify
    // M2 and prepare keys, but include `requires2FA: true` to tell
    // the client to prompt for a TOTP code before proceeding. The
    // session is only created in /login/verify-2fa after the code
    // checks out.
    //
    // The srpSessionId is re-used as a short-lived token binding the
    // SRP proof to the 2FA step. We DON'T delete it here if 2FA is
    // required — it stays alive for the 2FA follow-up. The session
    // row has its own TTL so orphans expire automatically.
    if (user.totp_secret) {
      // Rate limit still applies — reset only after full auth
      // (including 2FA). Don't reset here.
      return NextResponse.json({
        requires2FA: true,
        srpSessionId,
        serverProof,
        encryptedUserData: user.encrypted_user_data,
        publicEncryptionKey: user.public_encryption_key,
        publicSigningKey: user.public_signing_key,
      });
    }

    // No 2FA — proceed to full session.
    // Delete the one-time SRP session now that auth is complete.
    await deleteSrpSession(srpSessionId);

    // Create JWT session
    await createSession({ userId: user.id, email: user.email });
    auditEvent({ event: "auth.login.success", actorUserId: user.id });

    // Await instead of fire-and-forget — on Cloudflare Workers,
    // dangling promises get killed when the isolate tears down.
    const { supabase: sb } = await import("@/lib/db/supabase");
    await sb.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);

    await resetRateLimit(`login:${user.email}`);

    return NextResponse.json({
      serverProof,
      encryptedUserData: user.encrypted_user_data,
      publicEncryptionKey: user.public_encryption_key,
      publicSigningKey: user.public_signing_key,
    });
  } catch (err: unknown) {
    logError("auth.login.verify", err);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
