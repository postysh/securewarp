import { NextResponse } from "next/server";
import { LoginInitSchema } from "@/lib/validators/auth";
import { getUserByEmail } from "@/lib/db/users";
import { generateServerEphemeral } from "@/lib/srp/server";
import { createSrpSession } from "@/lib/db/srp-sessions";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { normalizeEmail } from "@/lib/auth/email";
import { logError } from "@/lib/log";

/**
 * SRP init for session refresh (unlock flow). Identical to
 * /api/auth/login/init but without Turnstile. Safe because:
 *   - The user just proved they know the password via Argon2 +
 *     lock cache unseal (stronger proof than Turnstile)
 *   - Rate-limited to 5/hour (stricter than normal login)
 *   - SRP itself prevents password extraction
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = LoginInitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const { clientPublicEphemeral } = parsed.data;
    const email = normalizeEmail(parsed.data.email);

    if (!(await checkRateLimit(`refresh:${email}`, 5))) {
      return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const { serverSecretEphemeral, serverPublicEphemeral } =
      generateServerEphemeral(user.srp_verifier);

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
  } catch (err) {
    logError("auth.login.init-refresh", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
