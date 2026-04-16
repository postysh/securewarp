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

    // Atomic replay protection via Postgres CAS. A plain read-then-
    // write has a TOCTOU race where two concurrent requests can both
    // read the old timestamp, both pass the < 30 check, and both
    // succeed. Instead, do a conditional UPDATE that only sets the new
    // stamp if the old one is far enough in the past. If the UPDATE
    // touches 0 rows, another request already consumed this window.
    const nowSec = Math.floor(Date.now() / 1000);
    const { supabase: sb } = await import("@/lib/db/supabase");
    const { data: updated, error: casErr } = await sb
      .from("users")
      .update({ totp_last_used_at: nowSec })
      .eq("id", user.id)
      .or(`totp_last_used_at.is.null,totp_last_used_at.lt.${nowSec - 30}`)
      .select("id");
    if (casErr) {
      logError("2fa.replay-check", casErr);
      return NextResponse.json({ error: "Verification failed" }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: "Code already used. Wait for a new code." },
        { status: 403 },
      );
    }

    // 2FA passed. Clean up, create session, the works.
    await deleteSrpSession(srpSessionId);
    await createSession({ userId: user.id, email: user.email });
    auditEvent({ event: "auth.login.success", actorUserId: user.id, detail: "2fa" });

    await sb.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);

    await resetRateLimit(`login:${user.email}`);
    await resetRateLimit(rlKey);

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("auth.login.verify-2fa", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
