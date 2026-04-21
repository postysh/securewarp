/**
 * Integration test — auth round-trip against real Supabase.
 *
 * What this proves (that unit tests with mocks cannot):
 *   1. Real Argon2id derives a master key deterministically from a
 *      password + salt across runs. If the canonical params ever
 *      drift, every existing account unlocks fails — this test pins
 *      that.
 *   2. The SRP-6a verifier produced by the client can actually be
 *      verified by the server module at login time. The two halves
 *      of the protocol live in different files; if the `info`
 *      identity string drifts on either side, login breaks.
 *   3. The Postgres schema accepts the insert shapes produced by the
 *      app (not just what the mocks thought it should accept).
 *
 * Run: npm run test:integration
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.test or
 * .env.local. Tests clean up after themselves; the afterAll hook
 * sweeps any stragglers by email prefix.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import * as srpServer from "secure-remote-password/server";
import * as srpClient from "secure-remote-password/client";
import {
  getTestClient,
  prepareRegistration,
  purgeTestState,
  deleteTestUser,
  deriveMasterKey,
} from "./helpers";
import {
  decryptUserData,
  decryptWithRecoveryKey,
} from "@/lib/crypto/keys";
import { splitMasterKey } from "@/lib/crypto/hkdf";
import { toHex, fromBase64 } from "@/lib/crypto/utils";

const createdEmails: string[] = [];

beforeAll(async () => {
  // Fail fast with a clear message if env is missing.
  getTestClient();
});

afterEach(async () => {
  // Per-test cleanup for the happy path. purgeTestState in afterAll
  // catches anything that escaped.
  while (createdEmails.length) {
    const email = createdEmails.pop()!;
    await deleteTestUser(email);
  }
});

afterAll(async () => {
  await purgeTestState();
});

describe("auth integration — register + login against real Postgres", () => {
  it("registers a user and the row matches the client-provided payload", async () => {
    const { body, account } = await prepareRegistration();
    createdEmails.push(account.email);

    const sb = getTestClient();
    const { data, error } = await sb
      .from("users")
      .insert({
        email: body.email,
        srp_salt: body.srpSalt,
        srp_verifier: body.srpVerifier,
        argon2_salt: body.argon2Salt,
        encrypted_user_data: JSON.stringify(body.encryptedUserData),
        public_encryption_key: body.publicEncryptionKey,
        recovery_key_hash: body.recoveryKeyHash,
        recovery_encrypted_data: JSON.stringify(body.recoveryEncryptedData),
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.email).toBe(account.email);
    expect(data!.srp_verifier).toBe(body.srpVerifier);
    expect(data!.public_encryption_key).toBe(account.keypairs.encryptionPublicKey);
  });

  it("SRP-6a login round-trips with the correct password", async () => {
    // Register a fresh account, then replay the full login protocol
    // against the real server module + real stored verifier.
    const { body, account } = await prepareRegistration();
    createdEmails.push(account.email);

    const sb = getTestClient();
    await sb.from("users").insert({
      email: body.email,
      srp_salt: body.srpSalt,
      srp_verifier: body.srpVerifier,
      argon2_salt: body.argon2Salt,
      encrypted_user_data: JSON.stringify(body.encryptedUserData),
      public_encryption_key: body.publicEncryptionKey,
      recovery_key_hash: body.recoveryKeyHash,
      recovery_encrypted_data: JSON.stringify(body.recoveryEncryptedData),
    });

    const { data: stored } = await sb
      .from("users")
      .select("srp_salt, srp_verifier, argon2_salt")
      .eq("email", account.email)
      .single();
    expect(stored).toBeTruthy();

    // ── Client step 1: generate ephemeral ─────────────────────────
    const clientEph = srpClient.generateEphemeral();

    // ── Server step 2: derive server ephemeral from stored verifier ──
    const serverEph = srpServer.generateEphemeral(stored!.srp_verifier);

    // ── Client step 3: derive session + proof ─────────────────────
    // Re-derive the SRP key the same way the browser does during login:
    // Argon2id(password, argon2Salt) → HKDF → srpKey.
    const masterAtLogin = deriveMasterKey(
      account.password,
      fromBase64(stored!.argon2_salt),
    );
    const { srpKey: srpKeyAtLogin } = splitMasterKey(masterAtLogin);
    const srpKeyHex = toHex(srpKeyAtLogin);
    const privateKey = srpClient.derivePrivateKey(
      stored!.srp_salt,
      "securewarp-user",
      srpKeyHex,
    );
    const clientSession = srpClient.deriveSession(
      clientEph.secret,
      serverEph.public,
      stored!.srp_salt,
      "securewarp-user",
      privateKey,
    );

    // ── Server step 4: verify proof, derive server proof ──────────
    const serverSession = srpServer.deriveSession(
      serverEph.secret,
      clientEph.public,
      stored!.srp_salt,
      "securewarp-user",
      stored!.srp_verifier,
      clientSession.proof,
    );

    // ── Client step 5: verify server proof ────────────────────────
    expect(() =>
      srpClient.verifySession(clientEph.public, clientSession, serverSession.proof),
    ).not.toThrow();
  });

  it("SRP-6a login rejects a wrong password", async () => {
    const { body, account } = await prepareRegistration();
    createdEmails.push(account.email);

    const sb = getTestClient();
    await sb.from("users").insert({
      email: body.email,
      srp_salt: body.srpSalt,
      srp_verifier: body.srpVerifier,
      argon2_salt: body.argon2Salt,
      encrypted_user_data: JSON.stringify(body.encryptedUserData),
      public_encryption_key: body.publicEncryptionKey,
      recovery_key_hash: body.recoveryKeyHash,
      recovery_encrypted_data: JSON.stringify(body.recoveryEncryptedData),
    });

    const { data: stored } = await sb
      .from("users")
      .select("srp_salt, srp_verifier, argon2_salt")
      .eq("email", account.email)
      .single();

    const clientEph = srpClient.generateEphemeral();
    const serverEph = srpServer.generateEphemeral(stored!.srp_verifier);

    // Derive srpKey from the WRONG password.
    const wrongMaster = deriveMasterKey(
      "wrong-password-entirely",
      fromBase64(stored!.argon2_salt),
    );
    const { srpKey: wrongSrpKey } = splitMasterKey(wrongMaster);
    const privateKey = srpClient.derivePrivateKey(
      stored!.srp_salt,
      "securewarp-user",
      toHex(wrongSrpKey),
    );
    const clientSession = srpClient.deriveSession(
      clientEph.secret,
      serverEph.public,
      stored!.srp_salt,
      "securewarp-user",
      privateKey,
    );

    // Server-side derivation MUST throw (proof mismatch).
    expect(() =>
      srpServer.deriveSession(
        serverEph.secret,
        clientEph.public,
        stored!.srp_salt,
        "securewarp-user",
        stored!.srp_verifier,
        clientSession.proof,
      ),
    ).toThrow();
  });

  it("encrypted user data round-trips through password and recovery key", async () => {
    // Proves that whatever we stored on disk during registration can
    // actually be decrypted by both paths a real user has: password
    // (normal login) and recovery key (lost password).
    const { body, account } = await prepareRegistration();
    createdEmails.push(account.email);

    const sb = getTestClient();
    await sb.from("users").insert({
      email: body.email,
      srp_salt: body.srpSalt,
      srp_verifier: body.srpVerifier,
      argon2_salt: body.argon2Salt,
      encrypted_user_data: JSON.stringify(body.encryptedUserData),
      public_encryption_key: body.publicEncryptionKey,
      recovery_key_hash: body.recoveryKeyHash,
      recovery_encrypted_data: JSON.stringify(body.recoveryEncryptedData),
    });

    const { data: stored } = await sb
      .from("users")
      .select("encrypted_user_data, recovery_encrypted_data, argon2_salt")
      .eq("email", account.email)
      .single();

    const encBlob = JSON.parse(stored!.encrypted_user_data) as {
      nonce: string;
      ciphertext: string;
    };
    const recBlob = JSON.parse(stored!.recovery_encrypted_data!) as {
      nonce: string;
      ciphertext: string;
    };

    // Password path.
    const master = deriveMasterKey(
      account.password,
      fromBase64(stored!.argon2_salt),
    );
    const { passwordDerivedSecret } = splitMasterKey(master);
    const viaPassword = decryptUserData(encBlob, passwordDerivedSecret);
    expect(viaPassword.encryptionPrivateKey).toBe(account.keypairs.encryptionPrivateKey);

    // Recovery path.
    const viaRecovery = decryptWithRecoveryKey(recBlob, account.recoveryKey);
    expect(viaRecovery.encryptionPrivateKey).toBe(account.keypairs.encryptionPrivateKey);
  });

  it("email unique constraint actually enforces at the DB layer", async () => {
    // The app normalizes at the boundary, but the DB is the last line
    // of defence. If somebody drops the unique constraint in a future
    // migration, this test catches it.
    const { body, account } = await prepareRegistration();
    createdEmails.push(account.email);

    const sb = getTestClient();
    await sb.from("users").insert({
      email: body.email,
      srp_salt: body.srpSalt,
      srp_verifier: body.srpVerifier,
      argon2_salt: body.argon2Salt,
      encrypted_user_data: JSON.stringify(body.encryptedUserData),
      public_encryption_key: body.publicEncryptionKey,
      recovery_key_hash: body.recoveryKeyHash,
      recovery_encrypted_data: JSON.stringify(body.recoveryEncryptedData),
    });

    const { error } = await sb.from("users").insert({
      email: body.email,
      srp_salt: body.srpSalt,
      srp_verifier: body.srpVerifier,
      argon2_salt: body.argon2Salt,
      encrypted_user_data: JSON.stringify(body.encryptedUserData),
      public_encryption_key: body.publicEncryptionKey,
      recovery_key_hash: body.recoveryKeyHash,
      recovery_encrypted_data: JSON.stringify(body.recoveryEncryptedData),
    });
    // Postgres unique_violation is SQLSTATE 23505.
    expect(error?.code).toBe("23505");
  });
});
