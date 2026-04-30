import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { logError } from "@/lib/log";
import {
  getRpConfig,
  signChallengeToken,
} from "@/lib/auth/passkey-server";

/**
 * POST — kick off a passkey login. Anonymous endpoint: no email, no
 * session required. The client invokes navigator.credentials.get()
 * with `mediation: "conditional"` (or explicit), the browser surfaces
 * any discoverable passkey scoped to this RP, and the user picks one.
 *
 * `allowCredentials` is intentionally empty — that's what makes this
 * a discoverable-credentials flow. The server doesn't yet know which
 * user is signing in.
 *
 * We don't return per-credential prfSalts here because we don't know
 * the credential id at request time. The browser holds the salts (it
 * was given them at enrollment? — no: the WebAuthn PRF extension
 * lets the relying party set the eval salt at get() time, but we
 * don't know the credential's specific salt until verify). So:
 * the client supplies a single PRF eval salt at get() time chosen
 * generically; we then look up the actual stored prf_salt at verify
 * time and IF it differs from what the client used, we fail and
 * tell the client to retry with the correct salt.
 *
 * Simpler alternative we use: `prfSalt` lookup at verify time — the
 * client retries get() with the correct salt if the first try used
 * a default. The full two-pass dance lives in the client lib; this
 * route just mints the challenge.
 */
export async function POST(request: Request) {
  try {
    const { rpID } = getRpConfig(request);

    const options = await generateAuthenticationOptions({
      rpID,
      // No allowCredentials → discoverable credential flow.
      userVerification: "preferred",
    });

    const challengeToken = await signChallengeToken({
      challenge: options.challenge,
      ceremony: "authentication",
    });

    return NextResponse.json({ options, challengeToken });
  } catch (err) {
    logError("passkey.login-options", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
