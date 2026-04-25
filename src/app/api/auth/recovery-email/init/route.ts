/**
 * Recover-via-email init — public.
 *
 * Step 1 of the email-recovery flow. The user types their account
 * email; we look up the user, confirm their recovery email is
 * verified, and return the wrap salt + ciphertext + the existing
 * recovery_encrypted_data so the client can:
 *
 *   1. Use the recovery token from the URL fragment to derive the
 *      Argon2id wrap key client-side.
 *   2. Decrypt the ciphertext to recover the 24-word mnemonic
 *      string.
 *   3. Run the existing /api/auth/recover (action: verify, action:
 *      update) flow with the recovered mnemonic.
 *
 * Generic responses: the route does NOT distinguish "no such user"
 * from "user has no recovery email" from "recovery email not
 * verified". Same generic 200 with an empty payload — the client
 * just gets "we have nothing for you" and the existing recover flow
 * surfaces the next failure (HMAC mismatch on hashRecoveryKey) if
 * the user is fishing.
 *
 * Rate-limited per normalized account email.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/db/supabase";
import { normalizeEmail } from "@/lib/auth/email";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { logError } from "@/lib/log";

const InitSchema = z.object({
  email: z.string().email(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = InitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const email = normalizeEmail(parsed.data.email);

    if (!(await checkRateLimit(`recovery-email-init:${email}`, 10, 60 * 60 * 1000))) {
      return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
    }

    const { data, error } = await supabase
      .from("users")
      .select(
        "recovery_email_verified_at, recovery_email_kdf_salt, recovery_email_wrapped_recovery_key, recovery_encrypted_data"
      )
      .eq("email", email)
      .maybeSingle();
    if (error) {
      logError("auth.recovery-email.init.lookup", error);
      return NextResponse.json({ available: false }, { status: 200 });
    }

    if (
      !data ||
      !data.recovery_email_verified_at ||
      !data.recovery_email_kdf_salt ||
      !data.recovery_email_wrapped_recovery_key
    ) {
      return NextResponse.json({ available: false });
    }

    return NextResponse.json({
      available: true,
      salt: data.recovery_email_kdf_salt,
      ciphertext: data.recovery_email_wrapped_recovery_key,
      // Pass through the existing recovery_encrypted_data so the
      // client can run the standard recover() pipeline once it has
      // unwrapped the mnemonic.
      recoveryEncryptedData: data.recovery_encrypted_data,
    });
  } catch (err) {
    logError("auth.recovery-email.init", err);
    return NextResponse.json({ available: false }, { status: 200 });
  }
}
