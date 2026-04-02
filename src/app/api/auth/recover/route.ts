import { NextResponse } from "next/server";
import { z } from "zod";
import { SignJWT, jwtVerify } from "jose";
import { timingSafeEqual } from "crypto";
import { getUserByEmail, updateUserAuth } from "@/lib/db/users";
import { createSession } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/auth/rate-limit";

const RECOVERY_TOKEN_EXPIRY = "5m";

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

// Track consumed recovery tokens to prevent reuse
const consumedTokens = new Set<string>();

// Step 1: Verify recovery key hash, return encrypted data + signed recovery token
const VerifySchema = z.object({
  action: z.literal("verify"),
  email: z.string().email(),
  recoveryKeyHash: z.string().min(1),
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

      const { email, recoveryKeyHash } = parsed.data;

      // Rate limit — 5 attempts per hour per email
      if (!checkRateLimit(`recover:${email}`, 5)) {
        return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
      }

      const user = await getUserByEmail(email);
      if (!user || !user.recovery_key_hash) {
        return NextResponse.json({ error: "Invalid email or recovery key" }, { status: 401 });
      }

      // Timing-safe comparison to prevent side-channel attacks
      const storedHash = Buffer.from(user.recovery_key_hash, "base64");
      const providedHash = Buffer.from(recoveryKeyHash, "base64");
      if (storedHash.length !== providedHash.length || !timingSafeEqual(storedHash, providedHash)) {
        return NextResponse.json({ error: "Invalid email or recovery key" }, { status: 401 });
      }

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
        if (!jti || consumedTokens.has(jti)) throw new Error("Token already used");
        consumedTokens.add(jti);
        // Clean old entries periodically
        if (consumedTokens.size > 1000) consumedTokens.clear();
      } catch {
        return NextResponse.json({ error: "Recovery session expired or already used. Please start over." }, { status: 401 });
      }

      const userId = tokenPayload.userId as string;
      const email = tokenPayload.email as string;

      // Update user credentials
      await updateUserAuth(userId, {
        srpSalt: data.newSrpSalt,
        srpVerifier: data.newSrpVerifier,
        argon2Salt: data.newArgon2Salt,
        encryptedUserData: data.newEncryptedUserData,
        recoveryKeyHash: data.newRecoveryKeyHash,
        recoveryEncryptedData: data.newRecoveryEncryptedData,
      });

      // Create session
      await createSession({ userId, email });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: unknown) {
    console.error("Recovery error:", err);
    return NextResponse.json({ error: "Recovery failed" }, { status: 500 });
  }
}
