import { NextResponse } from "next/server";
import { RegisterSchema } from "@/lib/validators/auth";
import { createUser, getUserByEmail } from "@/lib/db/users";
import { createSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = RegisterSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid registration data", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Check if user already exists — don't reveal email existence
    const existing = await getUserByEmail(data.email);
    if (existing) {
      return NextResponse.json(
        { error: "Unable to create account. Please try a different email or sign in." },
        { status: 400 }
      );
    }

    // Create user
    const user = await createUser({
      email: data.email,
      srpSalt: data.srpSalt,
      srpVerifier: data.srpVerifier,
      argon2Salt: data.argon2Salt,
      encryptedUserData: JSON.stringify(data.encryptedUserData),
      publicEncryptionKey: data.publicEncryptionKey,
      publicSigningKey: data.publicSigningKey,
      recoveryKeyHash: data.recoveryKeyHash,
      recoveryEncryptedData: data.recoveryEncryptedData
        ? JSON.stringify(data.recoveryEncryptedData)
        : undefined,
    });

    // Create session
    await createSession({ userId: user.id, email: user.email });

    return NextResponse.json({ success: true, userId: user.id });
  } catch (err: unknown) {
    console.error("Registration error:", err);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
