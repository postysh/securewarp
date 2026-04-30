import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";
import { auditEvent } from "@/lib/audit";
import {
  getRpConfig,
  verifyChallengeToken,
} from "@/lib/auth/passkey-server";

/**
 * POST — finalize passkey enrollment. Verifies the attestation the
 * authenticator returned, then persists the new credential alongside
 * the client-supplied wrapped blob (encrypted_user_data wrap, sealed
 * under HKDF(PRF_output) on the client).
 *
 * The server NEVER sees the PRF output. Body payload only carries
 * the already-wrapped ciphertext + the salt the client passed to the
 * authenticator. Anyone with this row + the corresponding passkey
 * (capable of producing the same PRF output) can unlock; nobody
 * else can.
 */

const BODY = z.object({
  attestationResponse: z.unknown(),
  challengeToken: z.string().min(1),
  prfSalt: z.string().min(1),
  wrappedUserData: z.string().min(1),
  wrappedUserDataNonce: z.string().min(1),
  nickname: z.string().min(1).max(64),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const raw = await request.json().catch(() => null);
    const parsed = BODY.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const expectedChallenge = await verifyChallengeToken(parsed.data.challengeToken, {
      ceremony: "registration",
      userId: session.userId,
    });
    if (!expectedChallenge) {
      return NextResponse.json(
        { error: "Challenge expired. Restart enrollment." },
        { status: 400 },
      );
    }

    const { rpID, expectedOrigin } = getRpConfig(request);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        // The library validates the shape internally; passing through
        // as `unknown` matches the expected contract from the browser
        // SDK without us needing a duplicate Zod schema for the
        // attestation tree.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        response: parsed.data.attestationResponse as any,
        expectedChallenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
    } catch (err) {
      logError("passkey.register-verify.attestation", err);
      return NextResponse.json({ error: "Attestation failed" }, { status: 400 });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: "Attestation failed" }, { status: 400 });
    }

    const info = verification.registrationInfo;
    const credential = info.credential;

    // Persist. credential_id + public_key are base64url strings as
    // returned by simplewebauthn (already in the format we want for
    // text columns).
    const publicKey = Buffer.from(credential.publicKey).toString("base64url");

    const { error: insertErr } = await supabase.from("user_passkeys").insert({
      user_id: session.userId,
      credential_id: credential.id,
      public_key: publicKey,
      counter: credential.counter,
      transports: credential.transports ?? [],
      prf_salt: parsed.data.prfSalt,
      wrapped_user_data: parsed.data.wrappedUserData,
      wrapped_user_data_nonce: parsed.data.wrappedUserDataNonce,
      is_backup_eligible: info.credentialBackedUp,
      is_backup_state: info.credentialBackedUp,
      nickname: parsed.data.nickname,
    });
    if (insertErr) {
      logError("passkey.register-verify.insert", insertErr);
      return NextResponse.json({ error: "Failed to save passkey" }, { status: 500 });
    }

    auditEvent({
      event: "auth.passkey.enroll",
      actorUserId: session.userId,
      detail: parsed.data.nickname,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("passkey.register-verify", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
