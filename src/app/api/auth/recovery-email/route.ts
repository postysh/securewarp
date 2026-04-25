/**
 * Recovery email — setup (POST) and clear (DELETE).
 *
 * Setup is the moment the user opts in (in the wizard or settings).
 * The client wraps the BIP39 mnemonic under a freshly-generated
 * recovery token, hashes nothing locally — it sends the plaintext
 * tokens here so we can email them and store only the hashes. The
 * server's exposure to the plaintext tokens is bounded to this
 * single request + the outbound email send. After the response,
 * the only persisted state is `sha256(recoveryToken)`,
 * `sha256(confirmToken)`, the wrap salt, the wrap ciphertext, the
 * `recovery_email` itself, and a 7-day confirm-token expiry.
 *
 * The recovery URL we email contains the recovery token in the URL
 * fragment — fragments aren't sent in HTTP requests, so the
 * server's outbound email body is the last server-side place the
 * plaintext recovery token is ever handled. The user is expected
 * to save the email; we cannot resend it.
 *
 * DELETE clears all recovery-email columns. Old emailed URLs stop
 * working immediately because the hashes they would have matched
 * against are gone.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { toBase64 } from "@/lib/crypto/utils";
import { safeCompare, base64ToBytes } from "@/lib/auth/safe-compare";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { sendEmail } from "@/lib/email/send";
import { normalizeEmail } from "@/lib/auth/email";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

const SetupSchema = z.object({
  recoveryEmail: z.string().email().max(254),
  recoveryToken: z.string().min(20).max(128),
  confirmToken: z.string().min(20).max(128),
  salt: z.string().min(1).max(128),
  ciphertext: z.string().min(1).max(4096),
  // Hash of the BIP39 phrase the client used to seal `ciphertext`.
  // We compare it to the stored `recovery_key_hash` so a user who
  // typoed their phrase doesn't end up with a useless wrap that
  // only fails at recovery time. If it doesn't match, we 400 and
  // do not touch any recovery-email columns.
  recoveryKeyHash: z.string().min(1).max(128),
});

const CONFIRM_EXPIRY_DAYS = 7;

function hashToken(token: string): string {
  return toBase64(sha256(new TextEncoder().encode(token)));
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate-limit setup attempts so a malicious client can't spam the
  // user's recovery inbox.
  if (!(await checkRateLimit(`recovery-email-setup:${session.userId}`, 5, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  try {
    const body = await request.json();
    const parsed = SetupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const recoveryEmail = normalizeEmail(parsed.data.recoveryEmail);

    // Refuse to set the recovery email to the user's own login
    // email — that would defeat the point of having a second
    // factor (an attacker who can read the login inbox already
    // has another path in via password reset). The check uses
    // the stored, normalized account email rather than the JWT
    // email so it survives a rename later.
    const { data: meRow, error: meErr } = await supabase
      .from("users")
      .select("email, recovery_key_hash")
      .eq("id", session.userId)
      .single();
    if (meErr || !meRow) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (normalizeEmail(meRow.email) === recoveryEmail) {
      return NextResponse.json(
        { error: "Recovery email must differ from your login email." },
        { status: 400 }
      );
    }
    if (
      !meRow.recovery_key_hash ||
      !safeCompare(
        base64ToBytes(meRow.recovery_key_hash),
        base64ToBytes(parsed.data.recoveryKeyHash)
      )
    ) {
      return NextResponse.json(
        { error: "That phrase doesn't match the one we have on file." },
        { status: 400 }
      );
    }

    const expiresAt = new Date(Date.now() + CONFIRM_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const { error: updErr } = await supabase
      .from("users")
      .update({
        recovery_email: recoveryEmail,
        recovery_email_verified_at: null,
        recovery_email_token_hash: hashToken(parsed.data.recoveryToken),
        recovery_email_wrapped_recovery_key: parsed.data.ciphertext,
        recovery_email_kdf_salt: parsed.data.salt,
        recovery_email_confirm_token_hash: hashToken(parsed.data.confirmToken),
        recovery_email_confirm_expires_at: expiresAt.toISOString(),
      })
      .eq("id", session.userId);
    if (updErr) {
      logError("auth.recovery-email.setup.update", updErr);
      return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }

    const origin = new URL(request.url).origin;
    const confirmUrl = `${origin}/recovery-email/confirm?ct=${encodeURIComponent(parsed.data.confirmToken)}`;
    // The /login page mounts AuthScreen which reads `#rt=` on
    // mount and opens the email-recovery modal. There's no
    // separate /recover route — recovery is just login+modal.
    const recoveryUrl = `${origin}/login#rt=${encodeURIComponent(parsed.data.recoveryToken)}`;

    // Email is fire-and-forget per AGENTS.md. If the send fails the
    // user can clear + retry from settings; the row is written so
    // they can verify on the next attempt with the same email.
    sendEmail({
      to: recoveryEmail,
      template: "recovery-email-setup",
      data: { confirmUrl, recoveryUrl },
    }).catch((err) => logError("email.recovery-email-setup", err));

    auditEvent({ event: "auth.recovery-email.setup", actorUserId: session.userId });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("auth.recovery-email.setup", err);
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { error } = await supabase
      .from("users")
      .update({
        recovery_email: null,
        recovery_email_verified_at: null,
        recovery_email_token_hash: null,
        recovery_email_wrapped_recovery_key: null,
        recovery_email_kdf_salt: null,
        recovery_email_confirm_token_hash: null,
        recovery_email_confirm_expires_at: null,
      })
      .eq("id", session.userId);
    if (error) {
      logError("auth.recovery-email.clear", error);
      return NextResponse.json({ error: "Clear failed" }, { status: 500 });
    }
    auditEvent({ event: "auth.recovery-email.clear", actorUserId: session.userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("auth.recovery-email.clear", err);
    return NextResponse.json({ error: "Clear failed" }, { status: 500 });
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("users")
    .select("recovery_email, recovery_email_verified_at")
    .eq("id", session.userId)
    .single();
  if (error || !data) {
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  return NextResponse.json({
    recoveryEmail: data.recovery_email ?? null,
    verifiedAt: data.recovery_email_verified_at ?? null,
  });
}
