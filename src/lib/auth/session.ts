/**
 * JWT session management using jose.
 * Creates/verifies signed JWTs stored in HttpOnly cookies.
 * Sessions are tracked in a DB table for revocation support.
 */

import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { supabase } from "@/lib/db/supabase";

const SESSION_COOKIE = "securewarp_session";
const SESSION_EXPIRY = "7d";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  email: string;
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);

  // Create a session record with a unique jti for revocation
  const { data: session, error } = await supabase
    .from("sessions")
    .insert({ user_id: payload.userId, expires_at: expiresAt.toISOString() })
    .select("jti")
    .single();
  if (error) throw new Error(`Failed to create session: ${error.message}`);

  const token = await new SignJWT({ ...payload, jti: session.jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_EXPIRY)
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret());
    const jti = payload.jti as string | undefined;

    // Verify the session hasn't been revoked
    if (jti) {
      const { data } = await supabase
        .from("sessions")
        .select("jti")
        .eq("jti", jti)
        .single();
      if (!data) return null; // Session was revoked
    }

    return {
      userId: payload.userId as string,
      email: payload.email as string,
    };
  } catch {
    return null;
  }
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  // Revoke the session in the DB
  if (token) {
    try {
      const { payload } = await jwtVerify(token, getSecret());
      if (payload.jti) {
        await supabase.from("sessions").delete().eq("jti", payload.jti as string);
      }
    } catch {
      // Token invalid — nothing to revoke
    }
  }

  cookieStore.delete(SESSION_COOKIE);
}

/**
 * Revoke ALL sessions for a user. Used by "logout all devices"
 * and password change flows.
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  await supabase.from("sessions").delete().eq("user_id", userId);
}
