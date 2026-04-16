import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";
import * as OTPAuth from "otpauth";

/**
 * POST — disable 2FA. Requires the current TOTP code as proof the
 * user still has access to their authenticator (prevents someone
 * with a stolen session from silently disabling 2FA).
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

    const { data: user } = await supabase
      .from("users")
      .select("totp_secret")
      .eq("id", session.userId)
      .single();

    if (!user?.totp_secret) {
      return NextResponse.json(
        { error: "Two factor authentication is not enabled." },
        { status: 409 },
      );
    }

    const totp = new OTPAuth.TOTP({
      issuer: "SecureWarp",
      label: session.userId,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(user.totp_secret),
    });

    const delta = totp.validate({ token: parsed.data.code, window: 1 });
    if (delta === null) {
      return NextResponse.json({ error: "Invalid code." }, { status: 403 });
    }

    const { error } = await supabase
      .from("users")
      .update({ totp_secret: null })
      .eq("id", session.userId);

    if (error) {
      logError("2fa.disable.save", error);
      return NextResponse.json({ error: "Failed to disable" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("2fa.disable", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
