import "server-only";
import { SignJWT, jwtVerify } from "jose";

/**
 * WebAuthn / passkey server helpers. The actual ceremony work is done
 * by `@simplewebauthn/server` — this file is just the SecureWarp-side
 * glue: deriving rpID + expectedOrigin from the request host, and
 * round-tripping the WebAuthn challenge as a signed JWT so we don't
 * need a server-side challenge table.
 *
 * Why a signed challenge instead of a DB row:
 *   - Challenges are single-use, short-lived, and not user-bound on
 *     the discoverable-credentials login path. A JWT carries the
 *     challenge + ceremony type + (optional) userId in a tamper-proof
 *     blob and expires automatically. No row to clean up.
 *   - The challenge itself is meaningless without a matching signed
 *     authenticator response — the JWT only proves "we issued this
 *     challenge". Single-use is enforced by the 5-minute expiry; an
 *     attacker who intercepts the JWT cannot generate a valid
 *     assertion without the user's authenticator.
 */

type Ceremony = "registration" | "authentication";

const CHALLENGE_TTL = "5m";

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export interface ChallengePayload {
  challenge: string;
  ceremony: Ceremony;
  userId?: string;
}

export async function signChallengeToken(p: ChallengePayload): Promise<string> {
  return await new SignJWT({
    challenge: p.challenge,
    ceremony: p.ceremony,
    ...(p.userId ? { userId: p.userId } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(CHALLENGE_TTL)
    .sign(getSecret());
}

export async function verifyChallengeToken(
  token: string,
  expected: { ceremony: Ceremony; userId?: string },
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.ceremony !== expected.ceremony) return null;
    if (expected.userId && payload.userId !== expected.userId) return null;
    const challenge = payload.challenge;
    return typeof challenge === "string" ? challenge : null;
  } catch {
    return null;
  }
}

/**
 * RP config derived from the request host. We deliberately collapse
 * `www.securewarp.com` and bare `securewarp.com` to the same rpID so
 * a credential enrolled under one is usable from the other (browsers
 * scope by registrable suffix). Localhost dev gets `http://` and the
 * full host:port as the origin.
 */
export function getRpConfig(request: Request): {
  rpID: string;
  rpName: string;
  expectedOrigin: string;
} {
  const host = request.headers.get("host")?.toLowerCase() ?? "localhost:3000";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.");
  const protocol = isLocal ? "http" : "https";
  const expectedOrigin = `${protocol}://${host}`;
  let rpID = host.split(":")[0];
  if (rpID.endsWith("securewarp.com")) rpID = "securewarp.com";
  return { rpID, rpName: "SecureWarp", expectedOrigin };
}
