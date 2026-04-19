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

    // window: 2 gives ±60 seconds of clock-drift tolerance — one
    // period before and one after the current 30s bucket. ±30s
    // (window: 1) was biting users whose desktop clocks drifted
    // more than half a minute. window: 2 is the de facto industry
    // norm; Google Authenticator + Authy both validate within the
    // same range server-side.
    const delta = totp.validate({ token: code, window: 2 });
    if (delta === null) {
      auditEvent({
        event: "auth.2fa.fail",
        actorUserId: user.id,
        detail: "invalid_totp",
      });
      return NextResponse.json({ error: "Invalid code." }, { status: 403 });
    }

    // Replay protection — atomic CAS via Postgres UPDATE. We store
    // the *timestep start time* (unix seconds aligned to 30s) of
    // the code that was just accepted. A fresh code in a later
    // timestep has a strictly greater start time and passes; the
    // exact same code re-submitted has the same start time and
    // fails (replay). Two concurrent requests hit the UPDATE's WHERE
    // clause and only one row matches, so concurrency is safe.
    //
    // Previously this used wall-clock "last 30 seconds" logic,
    // which wrongly rejected *different* codes submitted within
    // 30s of a previous success.
    const nowSec = Math.floor(Date.now() / 1000);
    const periodStart = (Math.floor(nowSec / 30) + delta) * 30;
    const { supabase: sb } = await import("@/lib/db/supabase");
    const { data: updated, error: casErr } = await sb
      .from("users")
      .update({ totp_last_used_at: periodStart })
      .eq("id", user.id)
      .or(`totp_last_used_at.is.null,totp_last_used_at.lt.${periodStart}`)
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
    await createSession({ userId: user.id, email: user.email }, request);
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
