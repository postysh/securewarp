import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getPublicUserByEmail } from "@/lib/db/users";
import { logError } from "@/lib/log";

// Small shape: only fields a sharer needs to wrap a session key.
const QuerySchema = z.object({ email: z.string().email() });

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({ email: searchParams.get("email") });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const user = await getPublicUserByEmail(parsed.data.email);
    if (!user) {
      // Generic 404 — don't expose whether an email is registered.
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      userId: user.id,
      email: user.email,
      publicEncryptionKey: user.public_encryption_key,
      publicKemKey: user.public_kem_key,
    });
  } catch (err) {
    logError("users.public-key", err);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}
