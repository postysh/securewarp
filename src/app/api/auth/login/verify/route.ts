import { NextResponse } from "next/server";
import { LoginVerifySchema } from "@/lib/validators/auth";
import { getUserById } from "@/lib/db/users";
import { getSrpSession, deleteSrpSession } from "@/lib/db/srp-sessions";
import { verifyClientAndDeriveSession } from "@/lib/srp/server";
import { createSession } from "@/lib/auth/session";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = LoginVerifySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid verification data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { srpSessionId, clientProof } = parsed.data;

    // Retrieve ephemeral session
    const srpSession = await getSrpSession(srpSessionId);
    if (!srpSession) {
      return NextResponse.json(
        { error: "Session expired or invalid" },
        { status: 401 }
      );
    }

    // Get user
    const user = await getUserById(srpSession.user_id);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 401 }
      );
    }

    // Verify client proof and derive server proof
    let serverProof: string;
    try {
      const result = verifyClientAndDeriveSession(
        srpSession.server_secret_ephemeral,
        srpSession.client_public_ephemeral,
        user.srp_salt,
        user.srp_verifier,
        clientProof
      );
      serverProof = result.serverProof;
    } catch {
      auditEvent({
        event: "auth.login.fail",
        actorUserId: user.id,
        detail: "srp_proof_mismatch",
      });
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Delete the one-time SRP session
    await deleteSrpSession(srpSessionId);

    // Create JWT session
    await createSession({ userId: user.id, email: user.email });
    auditEvent({ event: "auth.login.success", actorUserId: user.id });

    return NextResponse.json({
      serverProof,
      encryptedUserData: user.encrypted_user_data,
      publicEncryptionKey: user.public_encryption_key,
      publicSigningKey: user.public_signing_key,
    });
  } catch (err: unknown) {
    logError("auth.login.verify", err);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
