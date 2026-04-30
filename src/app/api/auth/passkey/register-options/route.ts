import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { logError } from "@/lib/log";
import {
  getRpConfig,
  signChallengeToken,
} from "@/lib/auth/passkey-server";
import { randomBytes } from "@/lib/crypto/utils";

/**
 * POST — kick off a passkey enrollment. Returns the
 * navigator.credentials.create() options + a signed challenge token
 * the client must echo back to /register-verify, plus a fresh
 * `prfSalt` the client uses on the same call to derive the wrap key.
 *
 * The PRF salt is per-credential (rule: never rotate it once the wrap
 * is stored). It travels here as a hint; the verify route reads the
 * authoritative copy back from the request body and persists it on
 * the user_passkeys row alongside the wrapped blob.
 *
 * Requires an active session — passkey enrollment is only ever a
 * post-unlock flow, never a way to bootstrap a new identity.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (
      !(await checkRateLimit(`passkey-register:${session.userId}`, 10, 60 * 60 * 1000))
    ) {
      return NextResponse.json(
        { error: "Too many enrollment attempts. Try again later." },
        { status: 429 },
      );
    }

    const { rpID, rpName } = getRpConfig(request);

    // Existing credentials we should NOT prompt the user to re-enroll
    // on. WebAuthn surfaces these via `excludeCredentials`; without
    // them a user can accidentally double-enroll the same authenticator.
    const { data: existing, error: existingErr } = await supabase
      .from("user_passkeys")
      .select("credential_id, transports")
      .eq("user_id", session.userId);
    if (existingErr) {
      logError("passkey.register-options.existing", existingErr);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    const options = await generateRegistrationOptions({
      rpID,
      rpName,
      // WebAuthn user handle — must be opaque + stable per user. Use
      // the userId so re-enrollment on a fresh authenticator surfaces
      // as the same user across the platform credential store.
      userID: new TextEncoder().encode(session.userId),
      userName: session.email,
      userDisplayName: session.email,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "preferred",
      },
      excludeCredentials: (existing ?? []).map((c) => ({
        id: c.credential_id,
        transports: c.transports as
          | ("internal" | "usb" | "nfc" | "ble" | "hybrid")[]
          | undefined,
      })),
    });

    // Per-credential PRF salt (32 random bytes). Sent here so the
    // browser can pass it through to the authenticator on the next
    // assertion to re-derive the same secret. Stored on the row in
    // /register-verify; never rotated.
    const prfSaltBytes = randomBytes(32);
    const prfSalt = Buffer.from(prfSaltBytes).toString("base64url");

    const challengeToken = await signChallengeToken({
      challenge: options.challenge,
      ceremony: "registration",
      userId: session.userId,
    });

    return NextResponse.json({
      options,
      challengeToken,
      prfSalt,
    });
  } catch (err) {
    logError("passkey.register-options", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
