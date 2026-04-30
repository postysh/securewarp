import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { supabase } from "@/lib/db/supabase";
import { createSession } from "@/lib/auth/session";
import { checkRateLimit, resetRateLimit } from "@/lib/auth/rate-limit";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";
import {
  getRpConfig,
  verifyChallengeToken,
} from "@/lib/auth/passkey-server";

/**
 * POST — finalize passkey login. Anonymous endpoint. Verifies the
 * assertion against the stored credential, mints a session, and
 * returns the wrapped user-data blob + the credential's prf_salt so
 * the client can re-derive the PRF wrap key (with a second navigator
 * .credentials.get() call carrying the right salt) and unlock the
 * session keys.
 *
 * Rate-limited per credential id. The credential id alone is not a
 * secret (it's discoverable from the device's credential store), so
 * we additionally rate-limit by IP to defeat distributed attacks
 * that rotate through stolen credential ids.
 *
 * Counter regression rejects the assertion: a credential whose
 * counter goes backwards is almost certainly cloned (some platform
 * authenticators report counter=0 always; we handle that case in
 * the verify call by tracking newCounter > stored).
 */

const BODY = z.object({
  assertionResponse: z.unknown(),
  challengeToken: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = BODY.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    // Pull the credential id off the assertion so we can look up the
    // stored row before invoking the heavy verifier. The shape comes
    // from the WebAuthn browser SDK; treat as untrusted until verified.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const assertion = parsed.data.assertionResponse as any;
    const credentialId =
      typeof assertion?.id === "string" ? (assertion.id as string) : null;
    if (!credentialId) {
      return NextResponse.json({ error: "Invalid assertion" }, { status: 400 });
    }

    // Per-credential + per-IP rate limit. 20/hour is generous for a
    // legitimate user toggling between devices and tight enough to
    // make brute-forcing a discoverable credential id pointless.
    const ip =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    if (
      !(await checkRateLimit(`passkey-login:${credentialId}`, 20, 60 * 60 * 1000)) ||
      !(await checkRateLimit(`passkey-login-ip:${ip}`, 60, 60 * 60 * 1000))
    ) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429 },
      );
    }

    const expectedChallenge = await verifyChallengeToken(parsed.data.challengeToken, {
      ceremony: "authentication",
    });
    if (!expectedChallenge) {
      return NextResponse.json(
        { error: "Challenge expired. Restart sign in." },
        { status: 400 },
      );
    }

    const { data: row, error: rowErr } = await supabase
      .from("user_passkeys")
      .select(
        "id, user_id, credential_id, public_key, counter, transports, prf_salt, wrapped_user_data, wrapped_user_data_nonce",
      )
      .eq("credential_id", credentialId)
      .single();
    if (rowErr || !row) {
      auditEvent({
        event: "auth.passkey.login.fail",
        detail: "credential_not_found",
      });
      return NextResponse.json({ error: "Sign in failed" }, { status: 401 });
    }

    const { rpID, expectedOrigin } = getRpConfig(request);

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        response: assertion,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: rpID,
        credential: {
          id: row.credential_id,
          publicKey: new Uint8Array(Buffer.from(row.public_key, "base64url")),
          counter: Number(row.counter),
          transports: row.transports as
            | ("internal" | "usb" | "nfc" | "ble" | "hybrid")[]
            | undefined,
        },
        requireUserVerification: false,
      });
    } catch (err) {
      auditEvent({
        event: "auth.passkey.login.fail",
        actorUserId: row.user_id,
        detail: "assertion_invalid",
      });
      logError("passkey.login-verify.assertion", err);
      return NextResponse.json({ error: "Sign in failed" }, { status: 401 });
    }

    if (!verification.verified) {
      auditEvent({
        event: "auth.passkey.login.fail",
        actorUserId: row.user_id,
        detail: "verification_failed",
      });
      return NextResponse.json({ error: "Sign in failed" }, { status: 401 });
    }

    // Suspension check after verification (matches login/verify
    // ordering — don't expose account state to unauthenticated callers).
    const { data: user } = await supabase
      .from("users")
      .select(
        "id, email, suspended_at, suspended_reason, public_encryption_key, public_kem_key",
      )
      .eq("id", row.user_id)
      .single();
    if (!user) {
      return NextResponse.json({ error: "Sign in failed" }, { status: 401 });
    }
    if (user.suspended_at) {
      auditEvent({
        event: "auth.passkey.login.fail",
        actorUserId: user.id,
        detail: "suspended",
      });
      return NextResponse.json(
        {
          error: "Account suspended",
          suspended: true,
          reason: user.suspended_reason ?? null,
        },
        { status: 403 },
      );
    }

    // Counter bump + last_used. Errors here don't block the login —
    // a transient DB hiccup shouldn't lock a user out — but they DO
    // mean we lose replay protection on the next attempt for this
    // credential. Log so it surfaces in observability.
    const newCounter = verification.authenticationInfo.newCounter;
    const { error: updateErr } = await supabase
      .from("user_passkeys")
      .update({
        counter: newCounter,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updateErr) {
      logError("passkey.login-verify.counter-bump", updateErr);
    }

    await createSession({ userId: user.id, email: user.email }, request);
    auditEvent({
      event: "auth.passkey.login.success",
      actorUserId: user.id,
    });

    await resetRateLimit(`passkey-login:${credentialId}`);
    await resetRateLimit(`passkey-login-ip:${ip}`);

    // Mirror the password-login response shape so the client can run
    // the same downstream key-loading code with a different unlock
    // path. encryptedUserData is included for completeness — the
    // passkey-unlocked client decrypts wrappedUserData instead.
    return NextResponse.json({
      wrappedUserData: row.wrapped_user_data,
      wrappedUserDataNonce: row.wrapped_user_data_nonce,
      prfSalt: row.prf_salt,
      email: user.email,
      publicEncryptionKey: user.public_encryption_key,
      publicKemKey: user.public_kem_key,
    });
  } catch (err) {
    logError("passkey.login-verify", err);
    return NextResponse.json({ error: "Sign in failed" }, { status: 500 });
  }
}
