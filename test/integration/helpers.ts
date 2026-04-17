/**
 * Integration test helpers — isolation + cleanup.
 *
 * Tests share a real Supabase project, so correctness depends on
 * namespacing every piece of state by a unique per-test run. Emails
 * use a `sw-int-<ts>-<rand>@securewarp.test` shape so cleanup can
 * delete everything by prefix if a test crashes mid-run.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { argon2id } from "@noble/hashes/argon2.js";
import { splitMasterKey } from "@/lib/crypto/hkdf";
import {
  generateRegistrationData,
  generateClientEphemeral,
  deriveClientSession,
} from "@/lib/srp/client";
import {
  generateKeypairs,
  encryptUserData,
  generateRecoveryKey,
  encryptWithRecoveryKey,
  hashRecoveryKey,
} from "@/lib/crypto/keys";
import { toBase64 } from "@/lib/crypto/utils";

// Unique tag used to identify all rows created by integration tests.
// Tag is email-local-part-safe so it survives through the users table.
const TEST_TAG = "sw-int";

export function getTestClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Integration tests require SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (see .env.test or .env.local).",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Make a unique test email guaranteed not to collide with any real user. */
export function uniqueEmail(tag = "auth"): string {
  const rand = randomBytes(6).toString("hex");
  return `${TEST_TAG}-${tag}-${Date.now()}-${rand}@securewarp.test`;
}

/** Delete a test user (and any cascaded rows). Silent on not-found. */
export async function deleteTestUser(email: string): Promise<void> {
  const sb = getTestClient();
  const { data: user } = await sb
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (!user) return;
  // FK cascades handle files, file_keys, sessions, notifications, etc.
  await sb.from("users").delete().eq("id", user.id);
}

/**
 * Delete every user created by integration tests. Call from a global
 * teardown to cap stray data in a dev/staging project. Also scrubs
 * rate_limits and srp_sessions that accumulate per-run.
 */
export async function purgeTestState(): Promise<void> {
  const sb = getTestClient();
  await sb.from("users").delete().like("email", `${TEST_TAG}-%`);
  await sb.from("rate_limits").delete().like("key", `%${TEST_TAG}%`);
  // Expired SRP sessions get cleaned on next login/init naturally; no
  // explicit wipe needed.
}

/**
 * Derive the master key the way the browser does: Argon2id over
 * (password, argon2Salt) with the SecureWarp parameter set.
 *
 * Matches src/hooks/use-auth.ts. The canonical value here is load-
 * bearing — if the browser changes parameters without versioning,
 * existing accounts stop unlocking. Integration tests locking them in.
 */
const ARGON2_ITERATIONS = 3;
const ARGON2_MEMORY_KB = 64 * 1024;
const ARGON2_PARALLELISM = 1;
const MASTER_KEY_LENGTH = 32;

export function deriveMasterKey(
  password: string,
  argon2Salt: Uint8Array,
): Uint8Array {
  return argon2id(password, argon2Salt, {
    t: ARGON2_ITERATIONS,
    m: ARGON2_MEMORY_KB,
    p: ARGON2_PARALLELISM,
    dkLen: MASTER_KEY_LENGTH,
  });
}

export interface TestAccount {
  email: string;
  password: string;
  recoveryKey: string;
  argon2Salt: Uint8Array;
  masterKey: Uint8Array;
  srpKey: Uint8Array;
  passwordDerivedSecret: Uint8Array;
  keypairs: ReturnType<typeof generateKeypairs>;
}

/**
 * Build a fresh registration payload the way the browser would. Returns
 * both the body you'd POST to /api/auth/register and the secrets the
 * client would cache in sessionStorage.
 */
export async function prepareRegistration(email?: string): Promise<{
  body: Record<string, unknown>;
  account: TestAccount;
}> {
  const actualEmail = email ?? uniqueEmail();
  const password = `Corr3ct-Horse-${randomBytes(4).toString("hex")}`;
  const argon2Salt = randomBytes(16);
  const masterKey = deriveMasterKey(password, argon2Salt);
  const { srpKey, passwordDerivedSecret } = splitMasterKey(masterKey);

  const { srpSalt, srpVerifier } = generateRegistrationData(srpKey);
  const keypairs = generateKeypairs();
  const encryptedUserData = encryptUserData(keypairs, passwordDerivedSecret);

  const recoveryKey = generateRecoveryKey();
  const recoveryEncryptedData = encryptWithRecoveryKey(keypairs, recoveryKey);
  const recoveryKeyHash = await hashRecoveryKey(recoveryKey);

  const body = {
    email: actualEmail,
    srpSalt,
    srpVerifier,
    argon2Salt: toBase64(argon2Salt),
    encryptedUserData: {
      nonce: encryptedUserData.nonce,
      ciphertext: encryptedUserData.ciphertext,
    },
    publicEncryptionKey: keypairs.encryptionPublicKey,
    publicSigningKey: keypairs.signingPublicKey,
    recoveryKeyHash,
    recoveryEncryptedData: {
      nonce: recoveryEncryptedData.nonce,
      ciphertext: recoveryEncryptedData.ciphertext,
    },
  };

  return {
    body,
    account: {
      email: actualEmail,
      password,
      recoveryKey,
      argon2Salt,
      masterKey,
      srpKey,
      passwordDerivedSecret,
      keypairs,
    },
  };
}

/**
 * Re-derive the exact SRP client proof the browser produces for a
 * known login. Used after /login/init returns the server ephemeral.
 */
export function deriveLoginProof(
  account: TestAccount,
  srpSalt: string,
  serverPublicEphemeral: string,
): { clientPublicEphemeral: string; clientProof: string } {
  const ephemeral = generateClientEphemeral();
  const { clientPublicEphemeral, clientProof } = deriveClientSession(
    ephemeral.clientSecretEphemeral,
    ephemeral.clientPublicEphemeral,
    serverPublicEphemeral,
    srpSalt,
    account.srpKey,
  );
  return { clientPublicEphemeral, clientProof };
}

/**
 * Tiny helper: make a Request object for a route handler.
 */
export function jsonRequest(url: string, body: unknown, init?: RequestInit): Request {
  return new Request(`http://integration.local${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    body: JSON.stringify(body),
    ...init,
  });
}
