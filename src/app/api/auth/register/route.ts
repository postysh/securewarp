import { NextResponse } from "next/server";
import { RegisterSchema } from "@/lib/validators/auth";
import { createUser, getUserByEmail } from "@/lib/db/users";
import { createSession } from "@/lib/auth/session";
import { normalizeEmail } from "@/lib/auth/email";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { getBoolFlag } from "@/lib/flags";
import { auditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/email/send";
import { logError } from "@/lib/log";

export async function POST(request: Request) {
  try {
    // Feature-flag gate. Admin can pause signups during an abuse wave
    // without a redeploy. Check before doing any other work so we don't
    // burn a rate-limit bucket or spend Turnstile quota.
    if (!(await getBoolFlag("signups_enabled"))) {
      return NextResponse.json(
        { error: "Signups are temporarily disabled. Please try again later." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const parsed = RegisterSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid registration data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Gate signup on Turnstile (no-op until TURNSTILE_SECRET_KEY is set).
    const turnstile = await verifyTurnstile(data.turnstileToken, request);
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: "Verification required", reason: turnstile.reason },
        { status: 403 }
      );
    }

    // Canonicalise so `a@x.com` and `A@x.com` cannot register as two
    // distinct accounts. The DB `users.email` unique constraint is
    // case-sensitive so the only defence lives at this boundary.
    const email = normalizeEmail(data.email);

    // Rate limit by IP to prevent mass account creation
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!(await checkRateLimit(`register:${ip}`, 5))) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }

    // Check if user already exists — don't reveal email existence.
    // Add a baseline delay so the "already exists" path takes roughly
    // the same time as the "create new user" path. Without this, an
    // attacker can distinguish the two by response latency (~200ms vs
    // ~800ms) even though the error message is generic.
    const startMs = Date.now();
    const existing = await getUserByEmail(email);
    if (existing) {
      const elapsed = Date.now() - startMs;
      const pad = Math.max(0, 500 - elapsed);
      await new Promise((r) => setTimeout(r, pad));
      return NextResponse.json(
        { error: "Unable to create account. Please try a different email or sign in." },
        { status: 400 }
      );
    }

    // Create user
    const user = await createUser({
      email,
      srpSalt: data.srpSalt,
      srpVerifier: data.srpVerifier,
      argon2Salt: data.argon2Salt,
      encryptedUserData: JSON.stringify(data.encryptedUserData),
      publicEncryptionKey: data.publicEncryptionKey,
      publicKemKey: data.publicKemKey,
      recoveryKeyHash: data.recoveryKeyHash,
      recoveryEncryptedData: data.recoveryEncryptedData
        ? JSON.stringify(data.recoveryEncryptedData)
        : undefined,
    });

    // Create session
    await createSession({ userId: user.id, email: user.email }, request);
    auditEvent({ event: "auth.register", actorUserId: user.id });

    // Welcome email. We await it (rather than fire-and-forget) because
    // dangling promises get killed when the Cloudflare Worker isolate
    // tears down after the response returns. `sendEmail` never throws —
    // it logs and returns { ok: false } on failure — so awaiting it can
    // only add latency, not break registration.
    const origin = request.headers.get("origin") ?? new URL(request.url).origin;
    await sendEmail({
      to: user.email,
      template: "welcome",
      data: { displayName: null, driveUrl: `${origin}/drive` },
    });

    return NextResponse.json({ success: true, userId: user.id });
  } catch (err: unknown) {
    logError("auth.register", err);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
