/**
 * Integration test — file upload + hierarchical key chain round-trip
 * against real Postgres.
 *
 * Proves the full Phase 2+3 chain works end-to-end with real DB writes:
 *   - Owner uploads a file. Session key wrapped to file pub hier key.
 *     Owner's file_keys row wraps priv hier key to owner's pub enc key.
 *   - Owner shares with Bob. Bob gets a file_keys row (priv hier wrapped
 *     to Bob's pub enc key with owner as sender).
 *   - Bob reads the row, unwraps priv hier, then session key, then
 *     metadata. All against real DB-stored ciphertext.
 *   - Folder child uses parent_keys_claim. Bob can reach it via the
 *     parent's priv hier without a direct file_keys row.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  getTestClient,
  prepareRegistration,
  purgeTestState,
  deleteTestUser,
} from "./helpers";
import {
  generateSessionKey,
  generateHierarchicalKeypair,
  wrapSessionKeyToFile,
  unwrapSessionKeyFromFile,
  wrapPrivateHierarchicalKeyForUser,
  unwrapPrivateHierarchicalKey,
  wrapParentKeysClaim,
  unwrapParentKeysClaim,
  encryptMetadata,
  decryptMetadata,
} from "@/lib/crypto/file-crypto";
import { toBase64 } from "@/lib/crypto/utils";

const createdEmails: string[] = [];

beforeAll(() => {
  getTestClient();
});

afterEach(async () => {
  while (createdEmails.length) {
    await deleteTestUser(createdEmails.pop()!);
  }
});

afterAll(async () => {
  await purgeTestState();
});

async function registerUser() {
  const sb = getTestClient();
  const { body, account } = await prepareRegistration();
  createdEmails.push(account.email);
  const { data: inserted } = await sb
    .from("users")
    .insert({
      email: body.email,
      srp_salt: body.srpSalt,
      srp_verifier: body.srpVerifier,
      argon2_salt: body.argon2Salt,
      encrypted_user_data: JSON.stringify(body.encryptedUserData),
      public_encryption_key: body.publicEncryptionKey,
      public_kem_key: account.keypairs.kemPublicKey,
      recovery_key_hash: body.recoveryKeyHash,
      recovery_encrypted_data: JSON.stringify(body.recoveryEncryptedData),
    })
    .select("id, email, public_encryption_key")
    .single();
  return {
    ...account,
    userId: inserted!.id as string,
  };
}

describe("file-crypto integration — owner → share → collaborator decrypt", () => {
  it("owner uploads, stores, and reads back file metadata via real DB", async () => {
    const owner = await registerUser();
    const sb = getTestClient();

    const sessionKey = generateSessionKey();
    const hier = generateHierarchicalKeypair();
    const metaPlain = { name: "test.txt", type: "text/plain", size: 42 };
    const encMeta = encryptMetadata(metaPlain, sessionKey);
    const sessionWrap = wrapSessionKeyToFile(
      sessionKey,
      hier.publicKeys,
      owner.keypairs.encryptionPrivateKey,
    );
    const ownerRow = wrapPrivateHierarchicalKeyForUser(
      hier.privateKeys,
      { x25519: owner.keypairs.encryptionPublicKey, kem: owner.keypairs.kemPublicKey },
      owner.keypairs.encryptionPrivateKey,
    );

    // Insert file + owner's file_keys row.
    const { data: file, error: fileErr } = await sb
      .from("files")
      .insert({
        owner_id: owner.userId,
        parent_id: null,
        encrypted_metadata: JSON.stringify(encMeta),
        is_folder: false,
        size_bytes: metaPlain.size,
        storage_key: null,
        public_hierarchical_key: hier.publicKeys.x25519,
        public_kem_hierarchical_key: hier.publicKeys.kem,
        encrypted_session_key_by_file: sessionWrap.encryptedSessionKeyByFile,
        session_key_nonce: sessionWrap.sessionKeyNonce,
        upload_complete: true,
      })
      .select("id")
      .single();
    expect(fileErr).toBeNull();

    const { error: keyErr } = await sb.from("file_keys").insert({
      file_id: file!.id,
      user_id: owner.userId,
      encrypted_private_hierarchical_key: ownerRow,
      wrapped_by_public_key: owner.keypairs.encryptionPublicKey,
      permission_level: "owner",
    });
    expect(keyErr).toBeNull();

    // Read the stored ciphertext and walk the chain.
    const { data: row } = await sb
      .from("files")
      .select(
        "encrypted_metadata, public_hierarchical_key, encrypted_session_key_by_file, session_key_nonce",
      )
      .eq("id", file!.id)
      .single();
    const { data: fk } = await sb
      .from("file_keys")
      .select("encrypted_private_hierarchical_key, wrapped_by_public_key")
      .eq("file_id", file!.id)
      .eq("user_id", owner.userId)
      .single();

    const privHier = unwrapPrivateHierarchicalKey(
      fk!.encrypted_private_hierarchical_key,
      fk!.wrapped_by_public_key,
      owner.keypairs.encryptionPrivateKey,
      owner.keypairs.kemPrivateKey,
    );
    const recoveredSession = unwrapSessionKeyFromFile(
      row!.encrypted_session_key_by_file,
      row!.session_key_nonce,
      owner.keypairs.encryptionPublicKey,
      privHier,
    );
    const meta = decryptMetadata(JSON.parse(row!.encrypted_metadata), recoveredSession);
    expect(meta).toEqual(metaPlain);
  });

  it("owner shares with Bob; Bob decrypts via real DB round-trip", async () => {
    const owner = await registerUser();
    const bob = await registerUser();
    const sb = getTestClient();

    const sessionKey = generateSessionKey();
    const hier = generateHierarchicalKeypair();
    const metaPlain = { name: "shared.txt", type: "text/plain", size: 7 };
    const encMeta = encryptMetadata(metaPlain, sessionKey);
    const sessionWrap = wrapSessionKeyToFile(
      sessionKey,
      hier.publicKeys,
      owner.keypairs.encryptionPrivateKey,
    );
    const ownerRow = wrapPrivateHierarchicalKeyForUser(
      hier.privateKeys,
      { x25519: owner.keypairs.encryptionPublicKey, kem: owner.keypairs.kemPublicKey },
      owner.keypairs.encryptionPrivateKey,
    );
    const bobRow = wrapPrivateHierarchicalKeyForUser(
      hier.privateKeys,
      { x25519: bob.keypairs.encryptionPublicKey, kem: bob.keypairs.kemPublicKey },
      owner.keypairs.encryptionPrivateKey,
    );

    const { data: file } = await sb
      .from("files")
      .insert({
        owner_id: owner.userId,
        parent_id: null,
        encrypted_metadata: JSON.stringify(encMeta),
        is_folder: false,
        size_bytes: metaPlain.size,
        storage_key: null,
        public_hierarchical_key: hier.publicKeys.x25519,
        public_kem_hierarchical_key: hier.publicKeys.kem,
        encrypted_session_key_by_file: sessionWrap.encryptedSessionKeyByFile,
        session_key_nonce: sessionWrap.sessionKeyNonce,
        upload_complete: true,
      })
      .select("id")
      .single();

    await sb.from("file_keys").insert([
      {
        file_id: file!.id,
        user_id: owner.userId,
        encrypted_private_hierarchical_key: ownerRow,
        wrapped_by_public_key: owner.keypairs.encryptionPublicKey,
        permission_level: "owner",
      },
      {
        file_id: file!.id,
        user_id: bob.userId,
        encrypted_private_hierarchical_key: bobRow,
        wrapped_by_public_key: owner.keypairs.encryptionPublicKey,
        permission_level: "viewer",
      },
    ]);

    // Bob's read path.
    const { data: row } = await sb
      .from("files")
      .select(
        "encrypted_metadata, encrypted_session_key_by_file, session_key_nonce, owner_id",
      )
      .eq("id", file!.id)
      .single();
    const { data: fk } = await sb
      .from("file_keys")
      .select("encrypted_private_hierarchical_key, wrapped_by_public_key")
      .eq("file_id", file!.id)
      .eq("user_id", bob.userId)
      .single();
    const { data: ownerPub } = await sb
      .from("users")
      .select("public_encryption_key")
      .eq("id", row!.owner_id)
      .single();

    const privHier = unwrapPrivateHierarchicalKey(
      fk!.encrypted_private_hierarchical_key,
      fk!.wrapped_by_public_key,
      bob.keypairs.encryptionPrivateKey,
      bob.keypairs.kemPrivateKey,
    );
    const recoveredSession = unwrapSessionKeyFromFile(
      row!.encrypted_session_key_by_file,
      row!.session_key_nonce,
      ownerPub!.public_encryption_key,
      privHier,
    );
    const meta = decryptMetadata(JSON.parse(row!.encrypted_metadata), recoveredSession);
    expect(meta).toEqual(metaPlain);
  });

  it("folder inheritance: Bob reaches child through parent_keys_claim, no direct row", async () => {
    const owner = await registerUser();
    const bob = await registerUser();
    const sb = getTestClient();

    // Folder F
    const folderHier = generateHierarchicalKeypair();
    const folderSessionKey = generateSessionKey();
    const folderMeta = encryptMetadata(
      { name: "Folder F", type: "application/folder", size: 0 },
      folderSessionKey,
    );
    const folderSessionWrap = wrapSessionKeyToFile(
      folderSessionKey,
      folderHier.publicKeys,
      owner.keypairs.encryptionPrivateKey,
    );
    const { data: folder } = await sb
      .from("files")
      .insert({
        owner_id: owner.userId,
        parent_id: null,
        encrypted_metadata: JSON.stringify(folderMeta),
        is_folder: true,
        size_bytes: 0,
        public_hierarchical_key: folderHier.publicKeys.x25519,
        public_kem_hierarchical_key: folderHier.publicKeys.kem,
        encrypted_session_key_by_file: folderSessionWrap.encryptedSessionKeyByFile,
        session_key_nonce: folderSessionWrap.sessionKeyNonce,
        upload_complete: true,
      })
      .select("id")
      .single();

    // Owner's file_keys row on the folder, and Bob's share row.
    await sb.from("file_keys").insert([
      {
        file_id: folder!.id,
        user_id: owner.userId,
        encrypted_private_hierarchical_key: wrapPrivateHierarchicalKeyForUser(
          folderHier.privateKeys,
          { x25519: owner.keypairs.encryptionPublicKey, kem: owner.keypairs.kemPublicKey },
          owner.keypairs.encryptionPrivateKey,
        ),
        wrapped_by_public_key: owner.keypairs.encryptionPublicKey,
        permission_level: "owner",
      },
      {
        file_id: folder!.id,
        user_id: bob.userId,
        encrypted_private_hierarchical_key: wrapPrivateHierarchicalKeyForUser(
          folderHier.privateKeys,
          { x25519: bob.keypairs.encryptionPublicKey, kem: bob.keypairs.kemPublicKey },
          owner.keypairs.encryptionPrivateKey,
        ),
        wrapped_by_public_key: owner.keypairs.encryptionPublicKey,
        permission_level: "viewer",
      },
    ]);

    // Child X inside F — owner has a direct row (invariant), but Bob
    // does NOT. Bob must reach X via parent_keys_claim.
    const xHier = generateHierarchicalKeypair();
    const xSessionKey = generateSessionKey();
    const xMetaPlain = { name: "inside.txt", type: "text/plain", size: 11 };
    const xMeta = encryptMetadata(xMetaPlain, xSessionKey);
    const xSessionWrap = wrapSessionKeyToFile(
      xSessionKey,
      xHier.publicKeys,
      owner.keypairs.encryptionPrivateKey,
    );
    const xParentClaim = wrapParentKeysClaim(
      xSessionKey,
      xHier.privateKeys,
      folderHier.publicKeys,
      owner.keypairs.encryptionPrivateKey,
    );
    const { data: x } = await sb
      .from("files")
      .insert({
        owner_id: owner.userId,
        parent_id: folder!.id,
        encrypted_metadata: JSON.stringify(xMeta),
        is_folder: false,
        size_bytes: xMetaPlain.size,
        public_hierarchical_key: xHier.publicKeys.x25519,
        public_kem_hierarchical_key: xHier.publicKeys.kem,
        encrypted_session_key_by_file: xSessionWrap.encryptedSessionKeyByFile,
        session_key_nonce: xSessionWrap.sessionKeyNonce,
        parent_keys_claim: xParentClaim,
        parent_keys_claim_wrapped_by: owner.keypairs.encryptionPublicKey,
        upload_complete: true,
      })
      .select("id")
      .single();

    // Owner's direct row on X (the invariant).
    await sb.from("file_keys").insert({
      file_id: x!.id,
      user_id: owner.userId,
      encrypted_private_hierarchical_key: wrapPrivateHierarchicalKeyForUser(
        xHier.privateKeys,
        { x25519: owner.keypairs.encryptionPublicKey, kem: owner.keypairs.kemPublicKey },
        owner.keypairs.encryptionPrivateKey,
      ),
      wrapped_by_public_key: owner.keypairs.encryptionPublicKey,
      permission_level: "owner",
    });
    // Bob intentionally has NO file_keys row on X.

    // Bob's read: fetch his folder_keys, fetch X (with owner pub key and
    // parent_keys_claim), walk the chain.
    const { data: folderKey } = await sb
      .from("file_keys")
      .select("encrypted_private_hierarchical_key, wrapped_by_public_key")
      .eq("file_id", folder!.id)
      .eq("user_id", bob.userId)
      .single();
    const bobFolderPriv = unwrapPrivateHierarchicalKey(
      folderKey!.encrypted_private_hierarchical_key,
      folderKey!.wrapped_by_public_key,
      bob.keypairs.encryptionPrivateKey,
      bob.keypairs.kemPrivateKey,
    );

    const { data: xRow } = await sb
      .from("files")
      .select("encrypted_metadata, parent_keys_claim, parent_keys_claim_wrapped_by")
      .eq("id", x!.id)
      .single();
    const xUnwrap = unwrapParentKeysClaim(
      xRow!.parent_keys_claim!,
      xRow!.parent_keys_claim_wrapped_by!,
      bobFolderPriv,
    );
    const xMetaDecrypted = decryptMetadata(
      JSON.parse(xRow!.encrypted_metadata),
      xUnwrap.sessionKey,
    );
    expect(xMetaDecrypted).toEqual(xMetaPlain);

    // And Bob indeed has NO direct row on X.
    const { data: xFk } = await sb
      .from("file_keys")
      .select("user_id")
      .eq("file_id", x!.id)
      .eq("user_id", bob.userId)
      .maybeSingle();
    expect(xFk).toBeNull();
  });

  it("the check_rate_limit RPC behaves correctly under real contention", async () => {
    // Proves the Postgres function enforces the limit atomically. The
    // unit-test mocks just return a boolean; this hits the actual
    // RPC and exercises the counter.
    const sb = getTestClient();
    const key = `sw-int-rate-${Date.now()}`;

    const burst = await Promise.all(
      Array.from({ length: 5 }, () =>
        sb.rpc("check_rate_limit", {
          p_key: key,
          p_max: 3,
          p_window_ms: 60 * 1000,
        }),
      ),
    );
    const allowed = burst.filter((r) => r.data === true).length;
    // With max=3 over a fresh key, exactly three of five concurrent
    // attempts should succeed. Not 4, not 2 — the RPC must be atomic.
    expect(allowed).toBe(3);

    // Cleanup so the bucket doesn't leak into another test run.
    await sb.from("rate_limits").delete().eq("key", key);
  });

  // Avoid a lint warning for the now-unused toBase64 import.
  void toBase64;
});
