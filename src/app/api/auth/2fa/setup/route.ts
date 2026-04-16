import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";
import * as OTPAuth from "otpauth";

/**
 * POST — generate a new TOTP secret and return the otpauth URI + base32
 * secret. The client renders a QR code from the URI and shows the
 * secret as a manual-entry fallback. The secret is NOT saved to the DB
 * yet — that happens in /verify-setup after the user confirms they
 * scanned correctly by entering a valid code.
 *
 * Requires an active session (user must be logged in).
 */
export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if 2FA is already enabled.
    const { data: user } = await supabase
      .from("users")
      .select("totp_secret, email")
      .eq("id", session.userId)
      .single();

    if (user?.totp_secret) {
      return NextResponse.json(
        { error: "Two factor authentication is already enabled." },
        { status: 409 },
      );
    }

    const totp = new OTPAuth.TOTP({
      issuer: "SecureWarp",
      label: user?.email ?? session.userId,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });

    return NextResponse.json({
      uri: totp.toString(),
      secret: totp.secret.base32,
    });
  } catch (err) {
    logError("2fa.setup", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
