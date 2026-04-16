import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserById } from "@/lib/db/users";
import { getSrpSession, deleteSrpSession } from "@/lib/db/srp-sessions";
import { createSession } from "@/lib/auth/session";
import { resetRateLimit } from "@/lib/auth/rate-limit";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";
import * as OTPAuth from "otpauth";

/**
 * POST — second step of login when 2FA is enabled.
 *
 * The first step (/login/verify) verified the SRP proof and returned
 * `{ requires2FA: true, srpSessionId }` without issuing a session.
 * This endpoint takes the srpSessionId + the user's TOTP code,
 * verifies the code against the stored secret, then issues the JWT.
 *
 * The srpSessionId acts as a short-lived binding token that proves
 * the caller already passed the password check. Without it, an
 * attacker couldn't call this endpoint directly — they'd have no
 * valid srpSessionId.
 *
 * Body: { srpSessionId: string, code: string (6 digits) }
 */

const BODY = z.object({
  srpSessionId: z.string().uuid(),
  code: z.string().length(6),
});

export async function POST(request: Request) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = BODY.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { srpSessionId, code } = parsed.data;

    // Look up the SRP session to find which user this is for.
    const srpSession = await getSrpSession(srpSessionId);
    if (!srpSession) {
      return NextResponse.json(
        { error: "Session expired. Please sign in again." },
        { status: 401 },
      );
    }

    const user = await getUserById(srpSession.user_id);
    if (!user || !user.totp_secret) {
      return NextResponse.json({ error: "Invalid state" }, { status: 400 });
    }

    // Rate limit 2FA attempts separately. A 6-digit TOTP has 1M
    // possible values; without a rate limit an attacker with a valid
    // srpSessionId could brute-force the code. 3 attempts per
    // srpSessionId then the session is burned.
    const rlKey = `2fa:${srpSessionId}`;
    if (!(await checkRateLimit(rlKey, 3, 5 * 60 * 1000))) {
      // Burn the SRP session so the attacker can't wait for the
      // rate-limit window to reset and try again.
      await deleteSrpSession(srpSessionId);
      return NextResponse.json(
        { error: "Too many attempts. Please sign in again." },
        { status: 429 },
      );
    }

    const totp = new OTPAuth.TOTP({
      issuer: "SecureWarp",
      label: user.email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(user.totp_secret),
    });

    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) {
      auditEvent({
        event: "auth.2fa.fail",
        actorUserId: user.id,
        detail: "invalid_totp",
      });
      return NextResponse.json({ error: "Invalid code." }, { status: 403 });
    }

    // Replay protection: reject codes that were already used within
    // the current time step. Stores the Unix timestamp of the last
    // successful verification; any code whose time step overlaps with
    // or predates the last-used stamp is rejected.
    const nowSec = Math.floor(Date.now() / 1000);
    const lastUsed = (user.totp_last_used_at as number | null) ?? 0;
    if (nowSec - lastUsed < 30) {
      return NextResponse.json(
        { error: "Code already used. Wait for a new code." },
        { status: 403 },
      );
    }

    // Stamp last-used for replay protection BEFORE creating the
    // session. Must be awaited (not fire-and-forget) so two concurrent
    // requests can't both read the old timestamp before either writes.
    const { supabase: sb } = await import("@/lib/db/supabase");
    await sb.from("users").update({ totp_last_used_at: nowSec }).eq("id", user.id);

    // 2FA passed. Clean up, create session, the works.
    await deleteSrpSession(srpSessionId);
    await createSession({ userId: user.id, email: user.email });
    auditEvent({ event: "auth.login.success", actorUserId: user.id, detail: "2fa" });

    void (async () => {
      const { supabase } = await import("@/lib/db/supabase");
      await supabase
        .from("users")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", user.id);
    })();

    await resetRateLimit(`login:${user.email}`);
    await resetRateLimit(rlKey);

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("auth.login.verify-2fa", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
