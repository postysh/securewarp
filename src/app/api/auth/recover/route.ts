import { NextResponse } from "next/server";
import { z } from "zod";
import { SignJWT, jwtVerify } from "jose";
import { safeCompare, base64ToBytes } from "@/lib/auth/safe-compare";
import { getUserByEmail, updateUserAuth } from "@/lib/db/users";
import { createSession } from "@/lib/auth/session";
import { checkRateLimit, resetRateLimit } from "@/lib/auth/rate-limit";
import { consumeRecoveryToken } from "@/lib/auth/used-tokens";
import { normalizeEmail } from "@/lib/auth/email";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

const RECOVERY_TOKEN_EXPIRY = "5m";

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

// Step 1: Verify recovery key hash, return encrypted data + signed recovery token
const VerifySchema = z.object({
  action: z.literal("verify"),
  email: z.string().email(),
  recoveryKeyHash: z.string().min(1),
  turnstileToken: z.string().optional(),
});

// Step 2: Update credentials — requires valid recovery token
const UpdateSchema = z.object({
  action: z.literal("update"),
  recoveryToken: z.string().min(1),
  newSrpSalt: z.string().min(1),
  newSrpVerifier: z.string().min(1),
  newArgon2Salt: z.string().min(1),
  newEncryptedUserData: z.string().min(1),
  newRecoveryKeyHash: z.string().optional(),
  newRecoveryEncryptedData: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // ─── VERIFY ───
    if (body.action === "verify") {
      const parsed = VerifySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid data" }, { status: 400 });
      }

      const { recoveryKeyHash, turnstileToken } = parsed.data;
      // Normalize so rate-limit keys + user lookups never vary by case.
      const email = normalizeEmail(parsed.data.email);

      const turnstile = await verifyTurnstile(turnstileToken, request);
      if (!turnstile.ok) {
        return NextResponse.json(
          { error: "Verification required", reason: turnstile.reason },
          { status: 403 }
        );
      }

      // Rate limit — 5 attempts per hour per normalized email
      if (!(await checkRateLimit(`recover:${email}`, 5))) {
        return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
      }

      const user = await getUserByEmail(email);
      if (!user || !user.recovery_key_hash) {
        auditEvent({ event: "auth.recovery.verify.fail", detail: "unknown_user" });
        return NextResponse.json({ error: "Invalid email or recovery key" }, { status: 401 });
      }

      // Timing-safe comparison to prevent side-channel attacks
      const storedHash = base64ToBytes(user.recovery_key_hash);
      const providedHash = base64ToBytes(recoveryKeyHash);
      if (!safeCompare(storedHash, providedHash)) {
        auditEvent({
          event: "auth.recovery.verify.fail",
          actorUserId: user.id,
          detail: "hash_mismatch",
        });
        return NextResponse.json({ error: "Invalid email or recovery key" }, { status: 401 });
      }

      auditEvent({ event: "auth.recovery.verify.success", actorUserId: user.id });

      // Generate a signed, single-use recovery token
      const jti = crypto.randomUUID();
      const recoveryToken = await new SignJWT({ userId: user.id, email: user.email, purpose: "recovery", jti })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(RECOVERY_TOKEN_EXPIRY)
        .sign(getSecret());

      return NextResponse.json({
        success: true,
        recoveryToken,
        recoveryEncryptedData: user.recovery_encrypted_data,
      });
    }

    // ─── UPDATE ───
    if (body.action === "update") {
      const parsed = UpdateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid data" }, { status: 400 });
      }

      const data = parsed.data;

      // Verify the recovery token (single-use)
      let tokenPayload;
      try {
        const result = await jwtVerify(data.recoveryToken, getSecret());
        tokenPayload = result.payload;
        if (tokenPayload.purpose !== "recovery") throw new Error("Invalid token purpose");
        const jti = tokenPayload.jti as string;
        const exp = tokenPayload.exp as number | undefined;
        if (!jti || !exp) throw new Error("Malformed token");
        const firstUse = await consumeRecoveryToken(jti, new Date(exp * 1000));
        if (!firstUse) throw new Error("Token already used");
      } catch {
        return NextResponse.json({ error: "Recovery session expired or already used. Please start over." }, { status: 401 });
      }

      const userId = tokenPayload.userId as string;
      const email = tokenPayload.email as string;

      // Suspension check — blocks suspended users from bypassing the
      // ban by resetting their password. Otherwise "admin suspends user"
      // would be trivially defeated by "user clicks forgot-password".
      // Checked after the recovery token is consumed so the token is
      // still single-use and the attacker can't retry.
      const { supabase } = await import("@/lib/db/supabase");
      const { data: suspendCheck } = await supabase
        .from("users")
        .select("suspended_at, suspended_reason")
        .eq("id", userId)
        .single();
      if (suspendCheck?.suspended_at) {
        auditEvent({
          event: "auth.recovery.verify.fail",
          actorUserId: userId,
          detail: "suspended",
        });
        return NextResponse.json(
          {
            error: "Account suspended",
            suspended: true,
            reason: suspendCheck.suspended_reason ?? null,
          },
          { status: 403 }
        );
      }

      // Update user credentials
      await updateUserAuth(userId, {
        srpSalt: data.newSrpSalt,
        srpVerifier: data.newSrpVerifier,
        argon2Salt: data.newArgon2Salt,
        encryptedUserData: data.newEncryptedUserData,
        recoveryKeyHash: data.newRecoveryKeyHash,
        recoveryEncryptedData: data.newRecoveryEncryptedData,
        clearTotp: true,
      });

      // Create session
      await createSession({ userId, email }, request);
      auditEvent({ event: "auth.recovery.update", actorUserId: userId });

      // Successful recovery — clear the bucket so the user can
      // sign in immediately without waiting out their own earlier
      // (failed) attempts.
      await resetRateLimit(`recover:${email}`);

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: unknown) {
    logError("auth.recover", err);
    return NextResponse.json({ error: "Recovery failed" }, { status: 500 });
  }
}
