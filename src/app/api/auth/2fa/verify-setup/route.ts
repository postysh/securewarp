import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";
import * as OTPAuth from "otpauth";

/**
 * POST — confirm the user scanned the QR code correctly by verifying
 * a TOTP code against the SERVER-STORED pending secret. On success,
 * promotes the pending secret to `users.totp_secret` and clears the
 * pending column. 2FA is now officially enabled.
 *
 * The secret is read from `users.totp_pending_secret` (set by /setup),
 * NOT from the request body. This prevents an attacker with a stolen
 * session from calling this endpoint with a secret they generated
 * themselves plus a matching code.
 *
 * Body: { code: string (6 digits) }
 */

const BODY = z.object({
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

    // Read the pending secret the server generated in /setup.
    const { data: user } = await supabase
      .from("users")
      .select("totp_pending_secret")
      .eq("id", session.userId)
      .single();

    if (!user?.totp_pending_secret) {
      return NextResponse.json(
        { error: "No pending setup. Start from Settings." },
        { status: 400 },
      );
    }

    const secret = user.totp_pending_secret as string;
    const totp = new OTPAuth.TOTP({
      issuer: "SecureWarp",
      label: session.userId,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    const delta = totp.validate({ token: parsed.data.code, window: 1 });
    if (delta === null) {
      return NextResponse.json(
        { error: "Invalid code. Make sure your authenticator is synced." },
        { status: 403 },
      );
    }

    // Promote: pending → active, clear pending.
    const { error } = await supabase
      .from("users")
      .update({ totp_secret: secret, totp_pending_secret: null })
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
