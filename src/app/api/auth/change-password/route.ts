import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { updateUserAuth } from "@/lib/db/users";

const ChangePasswordSchema = z.object({
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

    await updateUserAuth(session.userId, {
      srpSalt: data.newSrpSalt,
      srpVerifier: data.newSrpVerifier,
      argon2Salt: data.newArgon2Salt,
      encryptedUserData: data.newEncryptedUserData,
      recoveryKeyHash: data.newRecoveryKeyHash,
      recoveryEncryptedData: data.newRecoveryEncryptedData,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Change password error:", err);
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
  }
}
