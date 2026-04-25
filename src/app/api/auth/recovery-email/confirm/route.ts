/**
 * Recovery-email confirm — single-use, public.
 *
 * The confirm token is the URL query string our setup email built.
 * The recovery token (the *other* token in the same email) lives
 * in the URL fragment and never reaches us. The user clicks the
 * confirm link → the page POSTs the query token here → we hash it
 * and match against `recovery_email_confirm_token_hash` for the
 * unique row that points to it. On match, we mark
 * `verified_at = now()` and clear the confirm hash so the link
 * can't be reused.
 *
 * Public route: there is no session at confirm time (the user may
 * be confirming on a different device than the one they opted in
 * from). Authentication via the token's pre-image is the gate.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { toBase64 } from "@/lib/crypto/utils";
import { supabase } from "@/lib/db/supabase";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

const ConfirmSchema = z.object({
  confirmToken: z.string().min(20).max(128),
});

function hashToken(token: string): string {
  return toBase64(sha256(new TextEncoder().encode(token)));
}

export async function POST(request: Request) {
  // Rate-limit by IP-derived bucket. The token itself is high
  // entropy so brute force isn't a real concern; this just keeps a
  // misbehaving client from hammering the endpoint.
  const ipBucket =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (!(await checkRateLimit(`recovery-email-confirm:${ipBucket}`, 30, 60 * 1000))) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  try {
    const body = await request.json();
    const parsed = ConfirmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const tokenHash = hashToken(parsed.data.confirmToken);

    const { data, error } = await supabase
      .from("users")
      .select("id, recovery_email_confirm_expires_at")
      .eq("recovery_email_confirm_token_hash", tokenHash)
      .maybeSingle();
    if (error) {
      logError("auth.recovery-email.confirm.lookup", error);
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }
    if (!data) {
      // Generic error so a confirmed/expired link looks the same as
      // a forged one.
      return NextResponse.json(
        { error: "This confirmation link has expired or already been used." },
        { status: 400 }
      );
    }
    if (
      data.recovery_email_confirm_expires_at &&
      new Date(data.recovery_email_confirm_expires_at).getTime() < Date.now()
    ) {
      // Clear the stale row server-side so the bucket cleans up.
      await supabase
        .from("users")
        .update({
          recovery_email_confirm_token_hash: null,
          recovery_email_confirm_expires_at: null,
        })
        .eq("id", data.id);
      return NextResponse.json(
        { error: "This confirmation link has expired or already been used." },
        { status: 400 }
      );
    }

    const { error: updErr } = await supabase
      .from("users")
      .update({
        recovery_email_verified_at: new Date().toISOString(),
        recovery_email_confirm_token_hash: null,
        recovery_email_confirm_expires_at: null,
      })
      .eq("id", data.id);
    if (updErr) {
      logError("auth.recovery-email.confirm.update", updErr);
      return NextResponse.json({ error: "Confirm failed" }, { status: 500 });
    }

    auditEvent({ event: "auth.recovery-email.confirm", actorUserId: data.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("auth.recovery-email.confirm", err);
    return NextResponse.json({ error: "Confirm failed" }, { status: 500 });
  }
}
