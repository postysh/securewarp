import { NextResponse } from "next/server";
import { LoginInitSchema } from "@/lib/validators/auth";
import { getUserByEmail } from "@/lib/db/users";
import { generateServerEphemeral } from "@/lib/srp/server";
import { createSrpSession } from "@/lib/db/srp-sessions";
import { checkRateLimit } from "@/lib/auth/rate-limit";

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

    const { email, clientPublicEphemeral } = parsed.data;

    // Rate limit by email
    if (!checkRateLimit(`login:${email}`, 10)) {
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
    console.error("Login init error:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
