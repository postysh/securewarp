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
  public_kem_key: string;
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
  // Foundation for future multi-region R2. Set at signup from
  // CF-IPCountry. NOT currently used for routing — all data still
  // lands in the ENAM bucket set. See src/lib/billing/region.ts.
  r2_region?: "enam" | "wnam" | "weur" | "apac";
}

export async function createUser(data: {
  email: string;
  srpSalt: string;
  srpVerifier: string;
  argon2Salt: string;
  encryptedUserData: string;
  publicEncryptionKey: string;
  publicKemKey: string;
  recoveryKeyHash?: string;
  recoveryEncryptedData?: string;
  r2Region?: "enam" | "wnam" | "weur" | "apac";
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
      public_kem_key: data.publicKemKey,
      recovery_key_hash: data.recoveryKeyHash || null,
      recovery_encrypted_data: data.recoveryEncryptedData || null,
      r2_region: data.r2Region ?? "enam",
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
  public_kem_key: string;
}

export async function getPublicUserByEmail(email: string): Promise<PublicUserProfile | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id, email, public_encryption_key, public_kem_key")
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
    // Recovery-email handling. Any recoveryKeyHash rotation
    // invalidates the existing email-recovery wrap because it
    // seals the OLD phrase. Two callers, two behaviours:
    //
    //   - Recovery flow (`/api/auth/recover` action=update): the
    //     client holds the URL-fragment recovery token and will
    //     re-wrap the new phrase under the same token immediately
    //     after this call. We must NOT clear the columns
    //     `recovery_email`, `recovery_email_verified_at`, or
    //     `recovery_email_token_hash` — the rewrap endpoint reads
    //     them to verify the presented token. We DO clear the
    //     ciphertext + salt so the link fails closed if the
    //     rewrap never lands.
    //
    //   - Change-password flow (`/api/auth/change-password`): the
    //     user is signed in and chose a new password. They don't
    //     have the URL-fragment token in scope; even if they did,
    //     we don't want to silently mutate the wrap state from a
    //     password change. We clear ALL recovery-email columns
    //     and the user re-opts-in from Settings under their new
    //     phrase.
    preserveRecoveryEmailRow?: boolean;
  }
): Promise<void> {
  const updates: Record<string, unknown> = {
    srp_salt: data.srpSalt,
    srp_verifier: data.srpVerifier,
    argon2_salt: data.argon2Salt,
    encrypted_user_data: data.encryptedUserData,
    recovery_key_hash: data.recoveryKeyHash || null,
    recovery_encrypted_data: data.recoveryEncryptedData || null,
    // Stale-wrap material: cleared on every call. The recovery
    // flow re-fills these immediately via /rewrap; change-password
    // leaves them null until the user re-opts-in.
    recovery_email_wrapped_recovery_key: null,
    recovery_email_kdf_salt: null,
    recovery_email_confirm_token_hash: null,
    recovery_email_confirm_expires_at: null,
  };
  if (!data.preserveRecoveryEmailRow) {
    updates.recovery_email = null;
    updates.recovery_email_verified_at = null;
    updates.recovery_email_token_hash = null;
  }
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
