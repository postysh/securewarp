import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";
import * as OTPAuth from "otpauth";

/**
 * POST — confirm the user scanned the QR code correctly by verifying
 * a TOTP code against the provided secret. On success, persists the
 * secret to `users.totp_secret` and 2FA is officially enabled.
 *
 * Body: { secret: string (base32), code: string (6 digits) }
 */

const BODY = z.object({
  secret: z.string().min(16).max(64),
  code: z.string().length(6),
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

    const { secret, code } = parsed.data;

    const totp = new OTPAuth.TOTP({
      issuer: "SecureWarp",
      label: session.userId,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    // Allow ±1 window (±30s) for clock drift.
    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) {
      return NextResponse.json(
        { error: "Invalid code. Make sure your authenticator is synced." },
        { status: 403 },
      );
    }

    // Persist the secret — 2FA is now active on this account.
    const { error } = await supabase
      .from("users")
      .update({ totp_secret: secret })
      .eq("id", session.userId);

    if (error) {
      logError("2fa.verify-setup.save", error);
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("2fa.verify-setup", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
