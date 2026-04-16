import "server-only";
import { supabase } from "./supabase";

export interface UserRow {
  id: string;
  email: string;
  srp_salt: string;
  srp_verifier: string;
  argon2_salt: string;
  encrypted_user_data: string;
  public_encryption_key: string;
  public_signing_key: string;
  recovery_key_hash: string | null;
  recovery_encrypted_data: string | null;
  created_at: string;
  // Admin fields (phase 7). Set by the admin panel; read by auth paths
  // to block suspended users on login + recovery.
  role?: "user" | "admin" | "owner";
  suspended_at?: string | null;
  suspended_reason?: string | null;
  last_login_at?: string | null;
  // TOTP 2FA. Null = not enabled; base32 secret string = enabled.
  totp_secret?: string | null;
  // Pending TOTP secret from /2fa/setup before user confirms.
  totp_pending_secret?: string | null;
  // Unix timestamp of last successful TOTP verification (replay protection).
  totp_last_used_at?: number | null;
}

export async function createUser(data: {
  email: string;
  srpSalt: string;
  srpVerifier: string;
  argon2Salt: string;
  encryptedUserData: string;
  publicEncryptionKey: string;
  publicSigningKey: string;
  recoveryKeyHash?: string;
  recoveryEncryptedData?: string;
}): Promise<UserRow> {
  const { data: user, error } = await supabase
    .from("users")
    .insert({
      email: data.email,
      srp_salt: data.srpSalt,
      srp_verifier: data.srpVerifier,
      argon2_salt: data.argon2Salt,
      encrypted_user_data: data.encryptedUserData,
      public_encryption_key: data.publicEncryptionKey,
      public_signing_key: data.publicSigningKey,
      recovery_key_hash: data.recoveryKeyHash || null,
      recovery_encrypted_data: data.recoveryEncryptedData || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create user: ${error.message}`);
  return user;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", id)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch user: ${error.message}`);
  }

  return data || null;
}

/**
 * Thin public profile for share-grant lookups. Deliberately limited to the
 * fields a sharer needs (id + public encryption key) so the endpoint that
 * wraps this doesn't leak auth material like srp_verifier.
 */
export interface PublicUserProfile {
  id: string;
  email: string;
  public_encryption_key: string;
}

export async function getPublicUserByEmail(email: string): Promise<PublicUserProfile | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id, email, public_encryption_key")
    .eq("email", email)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch user: ${error.message}`);
  }
  return (data as PublicUserProfile) || null;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch user: ${error.message}`);
  }

  return data || null;
}

export async function updateUserAuth(
  userId: string,
  data: {
    srpSalt: string;
    srpVerifier: string;
    argon2Salt: string;
    encryptedUserData: string;
    recoveryKeyHash?: string;
    recoveryEncryptedData?: string;
    // When true, clears TOTP 2FA fields. Used by recovery (lost
    // phone) but NOT by change-password (user still has their
    // authenticator).
    clearTotp?: boolean;
  }
): Promise<void> {
  const updates: Record<string, unknown> = {
    srp_salt: data.srpSalt,
    srp_verifier: data.srpVerifier,
    argon2_salt: data.argon2Salt,
    encrypted_user_data: data.encryptedUserData,
    recovery_key_hash: data.recoveryKeyHash || null,
    recovery_encrypted_data: data.recoveryEncryptedData || null,
  };
  if (data.clearTotp) {
    updates.totp_secret = null;
    updates.totp_pending_secret = null;
    updates.totp_last_used_at = null;
  }
  const { error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", userId);

  if (error) throw new Error(`Failed to update user auth: ${error.message}`);
}
