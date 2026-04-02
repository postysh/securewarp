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
  }
): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({
      srp_salt: data.srpSalt,
      srp_verifier: data.srpVerifier,
      argon2_salt: data.argon2Salt,
      encrypted_user_data: data.encryptedUserData,
      recovery_key_hash: data.recoveryKeyHash || null,
      recovery_encrypted_data: data.recoveryEncryptedData || null,
    })
    .eq("id", userId);

  if (error) throw new Error(`Failed to update user auth: ${error.message}`);
}
