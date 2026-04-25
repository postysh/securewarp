/**
 * Recovery-email rewrap. Auth-required.
 *
 * Called by the client at the tail end of an email-link recovery
 * flow. The user's saved URL fragment carries a recovery token; the
 * client just used it to unwrap the OLD phrase, the recovery flow
 * generated a NEW phrase, and now we want the same URL to keep
 * working in the future. The client wraps the new phrase under the
 * same recovery token (with a fresh salt) and posts the new
 * ciphertext + salt here.
 *
 * Server-side gates:
 *   - Session must exist (the recovery flow just minted one).
 *   - Presented `recoveryToken` must hash to the stored
 *     `recovery_email_token_hash` for this user. Without this check,
 *     a logged-in user could overwrite their own wrap with arbitrary
 *     ciphertext (still safe — they'd just brick their own
 *     recovery email — but defense in depth).
 *   - Recovery email must already be verified. We don't activate a
 *     pending row through this path.
 *
 * Best-effort from the client's perspective: a failure here doesn't
 * undo the password reset, it just leaves the email link stale until
 * the user re-opts-in from Settings.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { toBase64 } from "@/lib/crypto/utils";
import { safeCompare, base64ToBytes } from "@/lib/auth/safe-compare";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

const RewrapSchema = z.object({
  recoveryToken: z.string().min(20).max(128),
  salt: z.string().min(1).max(128),
  ciphertext: z.string().min(1).max(4096),
});

function hashToken(token: string): string {
  return toBase64(sha256(new TextEncoder().encode(token)));
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = RewrapSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const { data: row, error } = await supabase
      .from("users")
      .select("recovery_email_token_hash, recovery_email_verified_at")
      .eq("id", session.userId)
      .single();
    if (error || !row) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (!row.recovery_email_token_hash || !row.recovery_email_verified_at) {
      return NextResponse.json({ error: "No verified recovery email" }, { status: 409 });
    }

    if (
      !safeCompare(
        base64ToBytes(row.recovery_email_token_hash),
        base64ToBytes(hashToken(parsed.data.recoveryToken))
      )
    ) {
      return NextResponse.json({ error: "Token mismatch" }, { status: 400 });
    }

    const { error: updErr } = await supabase
      .from("users")
      .update({
        recovery_email_kdf_salt: parsed.data.salt,
        recovery_email_wrapped_recovery_key: parsed.data.ciphertext,
      })
      .eq("id", session.userId);
    if (updErr) {
      logError("auth.recovery-email.rewrap.update", updErr);
      return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }

    auditEvent({ event: "auth.recovery-email.rewrap", actorUserId: session.userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("auth.recovery-email.rewrap", err);
    return NextResponse.json({ error: "Rewrap failed" }, { status: 500 });
  }
}
