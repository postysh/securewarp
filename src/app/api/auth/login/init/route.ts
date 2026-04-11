import { NextResponse } from "next/server";
import { LoginInitSchema } from "@/lib/validators/auth";
import { getUserByEmail } from "@/lib/db/users";
import { generateServerEphemeral } from "@/lib/srp/server";
import { createSrpSession } from "@/lib/db/srp-sessions";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { normalizeEmail } from "@/lib/auth/email";
import { verifyTurnstile } from "@/lib/auth/turnstile";
import { logError } from "@/lib/log";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = LoginInitSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid login data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { clientPublicEphemeral, turnstileToken } = parsed.data;
    // Normalize so rate-limit keys and user lookups never vary by case.
    const email = normalizeEmail(parsed.data.email);

    // Turnstile challenge (no-op if not provisioned). Check BEFORE the
    // rate limit so bots don't fill rate-limit buckets either.
    const turnstile = await verifyTurnstile(turnstileToken, request);
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: "Verification required", reason: turnstile.reason },
        { status: 403 }
      );
    }

    // Rate limit by normalized email
    if (!(await checkRateLimit(`login:${email}`, 10))) {
      return NextResponse.json({ error: "Too many login attempts. Try again later." }, { status: 429 });
    }

    // Look up user
    const user = await getUserByEmail(email);
    if (!user) {
      // Don't reveal whether email exists — return generic error
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Generate server ephemeral
    const { serverSecretEphemeral, serverPublicEphemeral } =
      generateServerEphemeral(user.srp_verifier);

    // Store server secret in ephemeral session
    const srpSessionId = await createSrpSession({
      userId: user.id,
      serverSecretEphemeral,
      clientPublicEphemeral,
    });

    return NextResponse.json({
      srpSessionId,
      srpSalt: user.srp_salt,
      argon2Salt: user.argon2_salt,
      serverPublicEphemeral,
    });
  } catch (err: unknown) {
    logError("auth.login.init", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
