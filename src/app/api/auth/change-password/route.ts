import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, revokeAllSessions, createSession } from "@/lib/auth/session";
import { getUserById, updateUserAuth } from "@/lib/db/users";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

const ChangePasswordSchema = z.object({
  // Old verifier proves the caller knows the current password without
  // sending the password itself. The client derives the old verifier
  // from the old password via the same SRP registration path, and the
  // server compares against the stored value. A session-stealer who
  // doesn't know the password can't produce a matching verifier.
  oldSrpVerifier: z.string().min(1),
  newSrpSalt: z.string().min(1),
  newSrpVerifier: z.string().min(1),
  newArgon2Salt: z.string().min(1),
  newEncryptedUserData: z.string().min(1),
  newRecoveryKeyHash: z.string().optional(),
  newRecoveryEncryptedData: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = ChangePasswordSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const data = parsed.data;

    if (!(await checkRateLimit(`change-pw:${session.userId}`, 5))) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }

    // Verify the old password by comparing the submitted verifier
    // against the one stored at registration/last-password-change.
    // Constant-time comparison isn't critical here (verifiers are
    // already public to the server), but we use string equality
    // which is fine for this threat model (stolen session, not
    // timing oracle).
    const user = await getUserById(session.userId);
    if (!user || user.srp_verifier !== data.oldSrpVerifier) {
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 403 },
      );
    }

    await updateUserAuth(session.userId, {
      srpSalt: data.newSrpSalt,
      srpVerifier: data.newSrpVerifier,
      argon2Salt: data.newArgon2Salt,
      encryptedUserData: data.newEncryptedUserData,
      recoveryKeyHash: data.newRecoveryKeyHash,
      recoveryEncryptedData: data.newRecoveryEncryptedData,
    });

    // Revoke all existing sessions (forces re-login on other devices)
    // then issue a fresh session for this device.
    await revokeAllSessions(session.userId);
    await createSession({ userId: session.userId, email: session.email });

    auditEvent({ event: "auth.password_change", actorUserId: session.userId });
    return NextResponse.json({ success: true });
  } catch (err) {
    logError("auth.change-password", err);
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
  }
}
