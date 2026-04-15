"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deriveMainKey } from "@/lib/crypto/argon2";
import { splitMasterKey } from "@/lib/crypto/hkdf";
import {
  generateKeypairs,
  encryptUserData,
  decryptUserData,
  decryptWithRecoveryKey,
  generateRecoveryKey,
  encryptWithRecoveryKey,
  hashRecoveryKey,
} from "@/lib/crypto/keys";
import {
  generateRegistrationData,
  generateClientEphemeral,
  deriveClientSession,
  verifyServerProof,
} from "@/lib/srp/client";
import { toBase64, randomBytes, fromBase64 } from "@/lib/crypto/utils";
import {
  saveLockCache,
  clearLockCache,
  readLockCacheMeta,
  unlockKeys,
} from "@/lib/auth/lock-cache";
import { clearMetadataCache } from "@/lib/cache/metadata-cache";

import type { UserKeys } from "./use-user-keys";

interface AuthState {
  loading: boolean;
  error: string | null;
  step: string | null;
  recoveryKey: string | null;
  userKeys: UserKeys | null;
  // Set when the server returns 403 with suspended=true. AuthScreen
  // swaps to a dedicated "account suspended" view when present.
  suspended: { reason: string | null } | null;
}

export function useAuth() {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    loading: false,
    error: null,
    step: null,
    recoveryKey: null,
    userKeys: null,
    suspended: null,
  });

  const setStep = (step: string) => setState((s) => ({ ...s, step, error: null }));
  const setError = (error: string) => setState((s) => ({ ...s, error, loading: false, step: null }));
  const setSuspended = (reason: string | null) =>
    setState((s) => ({ ...s, suspended: { reason }, loading: false, step: null, error: null }));

  async function signup(email: string, password: string, turnstileToken?: string) {
    setState({ loading: true, error: null, step: "Generating encryption keys...", recoveryKey: null, userKeys: null, suspended: null });

    try {
      // 1. Generate Argon2 salt and derive master key
      setStep("Deriving master key...");
      const argon2Salt = randomBytes(16);
      const masterKey = await deriveMainKey(password, argon2Salt);

      // 2. Split into SRP key + password-derived secret + unlock cache key
      setStep("Splitting keys...");
      const { srpKey, passwordDerivedSecret, unlockCacheKey } = splitMasterKey(masterKey);

      // 3. Generate SRP registration data
      setStep("Creating authentication verifier...");
      const { srpSalt, srpVerifier } = generateRegistrationData(srpKey);

      // 4. Generate encryption + signing keypairs
      setStep("Generating keypairs...");
      const keypairs = generateKeypairs();

      // 5. Encrypt private keys with password-derived secret
      setStep("Encrypting private keys...");
      const encryptedUserData = encryptUserData(keypairs, passwordDerivedSecret);

      // 6. Generate recovery key and encrypt private keys with it
      setStep("Generating recovery key...");
      const recoveryKey = generateRecoveryKey();
      const recoveryEncryptedData = encryptWithRecoveryKey(keypairs, recoveryKey);
      const recoveryKeyHash = await hashRecoveryKey(recoveryKey);

      // 7. Register with server
      setStep("Creating account...");
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          srpSalt,
          srpVerifier,
          argon2Salt: toBase64(argon2Salt),
          encryptedUserData,
          publicEncryptionKey: keypairs.encryptionPublicKey,
          publicSigningKey: keypairs.signingPublicKey,
          recoveryKeyHash,
          recoveryEncryptedData,
          turnstileToken,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        setError(result.error || "Registration failed");
        return;
      }

      // Store keys in sessionStorage (in-memory for this tab)
      const keys = { ...keypairs, email };
      sessionStorage.setItem("securewarp_keys", JSON.stringify(keys));
      window.dispatchEvent(new Event("securewarp-keys-updated"));

      // Persist the local lock cache so subsequent tab reopens can
      // re-derive these keys from the password alone without running
      // the full SRP handshake. Zero the wrapping key immediately.
      saveLockCache({
        email,
        argon2Salt: toBase64(argon2Salt),
        keys: {
          encryptionPublicKey: keypairs.encryptionPublicKey,
          encryptionPrivateKey: keypairs.encryptionPrivateKey,
          signingPublicKey: keypairs.signingPublicKey,
          signingPrivateKey: keypairs.signingPrivateKey,
        },
        unlockCacheKey,
      });
      unlockCacheKey.fill(0);

      // Success — store keys and recovery key for display
      setState({
        loading: false, error: null, step: null, recoveryKey,
        userKeys: keys, suspended: null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Signup failed";
      setError(message);
    }
  }

  async function login(email: string, password: string, turnstileToken?: string) {
    setState({ loading: true, error: null, step: "Initializing...", recoveryKey: null, userKeys: null, suspended: null });

    try {
      // 1. Generate client ephemeral
      setStep("Generating ephemeral...");
      const { clientSecretEphemeral, clientPublicEphemeral } = generateClientEphemeral();

      // 2. Send to server, get salt + server ephemeral
      setStep("Contacting server...");
      const initRes = await fetch("/api/auth/login/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, clientPublicEphemeral, turnstileToken }),
      });

      const initData = await initRes.json();
      if (!initRes.ok) {
        setError(initData.error || "Login failed");
        return;
      }

      const { srpSessionId, srpSalt, argon2Salt, serverPublicEphemeral } = initData;

      // 3. Derive master key from password + stored Argon2 salt
      setStep("Deriving master key...");
      const argon2SaltBytes = fromBase64(argon2Salt);
      const masterKey = await deriveMainKey(password, argon2SaltBytes);

      // 4. Split into SRP key + password-derived secret + unlock cache key
      const { srpKey, passwordDerivedSecret, unlockCacheKey } = splitMasterKey(masterKey);

      // 5. Derive client session + proof (M1)
      setStep("Verifying identity...");
      const { clientSession, clientPublicEphemeral: pubEph, clientProof } = deriveClientSession(
        clientSecretEphemeral,
        clientPublicEphemeral,
        serverPublicEphemeral,
        srpSalt,
        srpKey
      );

      // 6. Send M1 to server, get M2 + encrypted user data
      setStep("Authenticating...");
      const verifyRes = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ srpSessionId, clientProof }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        if (verifyRes.status === 403 && verifyData.suspended) {
          // Server rejected the login because the account is suspended.
          // Surface a dedicated state so AuthScreen can render the
          // suspension notice instead of a generic error banner.
          setSuspended(verifyData.reason ?? null);
          return;
        }
        setError(verifyData.error || "Authentication failed");
        return;
      }

      // 7. Verify server proof (M2)
      setStep("Verifying server...");
      try {
        verifyServerProof(pubEph, clientSession, verifyData.serverProof);
      } catch {
        setError("Server verification failed — possible MITM attack");
        return;
      }

      // 8. Decrypt private keys
      setStep("Decrypting private keys...");
      const encryptedData = typeof verifyData.encryptedUserData === "string"
        ? JSON.parse(verifyData.encryptedUserData)
        : verifyData.encryptedUserData;

      const privateKeys = decryptUserData(encryptedData, passwordDerivedSecret);

      // Store decrypted keys in sessionStorage for the drive page
      const keys = {
        encryptionPublicKey: verifyData.publicEncryptionKey,
        encryptionPrivateKey: privateKeys.encryptionPrivateKey,
        signingPublicKey: verifyData.publicSigningKey,
        signingPrivateKey: privateKeys.signingPrivateKey,
        email,
      };
      sessionStorage.setItem("securewarp_keys", JSON.stringify(keys));
      window.dispatchEvent(new Event("securewarp-keys-updated"));

      // Refresh the local lock cache using the unlock-cache key derived
      // in step 4 above. Password may have changed since the last
      // saved blob (or no blob existed on this device yet), so we
      // always overwrite. Zero the key immediately after.
      saveLockCache({
        email,
        argon2Salt,
        keys: {
          encryptionPublicKey: verifyData.publicEncryptionKey,
          encryptionPrivateKey: privateKeys.encryptionPrivateKey,
          signingPublicKey: verifyData.publicSigningKey,
          signingPrivateKey: privateKeys.signingPrivateKey,
        },
        unlockCacheKey,
      });
      unlockCacheKey.fill(0);

      // Success — navigate to drive
      setState({ loading: false, error: null, step: null, recoveryKey: null, userKeys: keys, suspended: null });
      router.push("/drive");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
    }
  }

  async function recover(email: string, recoveryWordsRaw: string, newPassword: string, turnstileToken?: string) {
    setState({ loading: true, error: null, step: "Verifying recovery key...", recoveryKey: null, userKeys: null, suspended: null });

    try {
      // Clean the recovery input — strip numbers, punctuation, extra whitespace, newlines
      const recoveryWords = recoveryWordsRaw
        .replace(/\d+\.\s*/g, "")  // remove "1. ", "2. " etc
        .replace(/[,;]/g, " ")      // replace commas/semicolons with spaces
        .replace(/\n/g, " ")        // newlines to spaces
        .replace(/\s+/g, " ")       // collapse whitespace
        .trim()
        .toLowerCase();

      // 1. Hash the recovery key (uses HKDF-derived verification key)
      const recoveryKeyHash = await hashRecoveryKey(recoveryWords);

      // 2. Step 1: Verify recovery key and get encrypted data + signed token
      setStep("Verifying recovery key...");
      const verifyRes = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", email, recoveryKeyHash, turnstileToken }),
      });

      const verifyResult = await verifyRes.json();
      if (!verifyRes.ok) {
        setError(verifyResult.error || "Recovery failed");
        return;
      }

      const { recoveryToken, recoveryEncryptedData: rawRecoveryData } = verifyResult;

      // 3. Decrypt private keys using HKDF-derived recovery encryption key
      setStep("Decrypting private keys...");
      const recoveryEncrypted = typeof rawRecoveryData === "string"
        ? JSON.parse(rawRecoveryData)
        : rawRecoveryData;

      const privateKeys = decryptWithRecoveryKey(recoveryEncrypted, recoveryWords);

      // 4. Derive new auth credentials from new password
      setStep("Deriving new master key...");
      const newArgon2Salt = randomBytes(16);
      const newMasterKey = await deriveMainKey(newPassword, newArgon2Salt);
      const {
        srpKey: newSrpKey,
        passwordDerivedSecret: newPds,
        unlockCacheKey: newUnlockCacheKey,
      } = splitMasterKey(newMasterKey);
      const { srpSalt: newSrpSalt, srpVerifier: newSrpVerifier } = generateRegistrationData(newSrpKey);

      // 5. Re-encrypt private keys with new password-derived secret
      setStep("Re-encrypting with new password...");
      const keypairs = {
        encryptionPublicKey: "recovered",
        encryptionPrivateKey: privateKeys.encryptionPrivateKey,
        signingPublicKey: "recovered",
        signingPrivateKey: privateKeys.signingPrivateKey,
      };
      const newEncryptedUserData = encryptUserData(keypairs, newPds);

      // 6. Generate new recovery key
      setStep("Generating new recovery key...");
      const newRecoveryKey = generateRecoveryKey();
      const newRecoveryEncryptedData = encryptWithRecoveryKey(keypairs, newRecoveryKey);
      const newRecoveryKeyHash = await hashRecoveryKey(newRecoveryKey);

      // 7. Step 2: Update server with signed recovery token (no re-sending hash)
      setStep("Updating account...");
      const updateRes = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          recoveryToken,
          newSrpSalt,
          newSrpVerifier,
          newArgon2Salt: toBase64(newArgon2Salt),
          newEncryptedUserData: JSON.stringify(newEncryptedUserData),
          newRecoveryKeyHash,
          newRecoveryEncryptedData: JSON.stringify(newRecoveryEncryptedData),
        }),
      });

      const updateResult = await updateRes.json();
      if (!updateRes.ok) {
        if (updateRes.status === 403 && updateResult.suspended) {
          setSuspended(updateResult.reason ?? null);
          return;
        }
        setError(updateResult.error || "Recovery update failed");
        return;
      }

      // Store recovered keys
      const recoveredKeys = {
        encryptionPublicKey: "recovered",
        encryptionPrivateKey: privateKeys.encryptionPrivateKey,
        signingPublicKey: "recovered",
        signingPrivateKey: privateKeys.signingPrivateKey,
        email,
      };
      sessionStorage.setItem("securewarp_keys", JSON.stringify(recoveredKeys));
      window.dispatchEvent(new Event("securewarp-keys-updated"));

      // Refresh the lock cache under the new password. Wipes any old
      // blob that was encrypted under the previous password — its
      // key material is no longer derivable.
      clearLockCache();
    clearMetadataCache();
      saveLockCache({
        email,
        argon2Salt: toBase64(newArgon2Salt),
        keys: {
          encryptionPublicKey: "recovered",
          encryptionPrivateKey: privateKeys.encryptionPrivateKey,
          signingPublicKey: "recovered",
          signingPrivateKey: privateKeys.signingPrivateKey,
        },
        unlockCacheKey: newUnlockCacheKey,
      });
      newUnlockCacheKey.fill(0);

      // Success — show new recovery key
      setState({ loading: false, error: null, step: null, recoveryKey: newRecoveryKey, userKeys: recoveredKeys, suspended: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Recovery failed";
      setError(message);
    }
  }

  async function changePassword(oldPassword: string, newPassword: string, email: string) {
    setState({ loading: true, error: null, step: "Verifying old password...", recoveryKey: null, userKeys: state.userKeys, suspended: null });

    try {
      // Get current argon2 salt from session storage keys
      const storedKeys = sessionStorage.getItem("securewarp_keys");
      if (!storedKeys) {
        setError("Session expired. Please log in again.");
        return;
      }
      const currentKeys = JSON.parse(storedKeys);

      // Derive new credentials from new password
      setStep("Deriving new master key...");
      const newArgon2Salt = randomBytes(16);
      const newMasterKey = await deriveMainKey(newPassword, newArgon2Salt);
      const {
        srpKey: newSrpKey,
        passwordDerivedSecret: newPds,
        unlockCacheKey: newUnlockCacheKey,
      } = splitMasterKey(newMasterKey);
      const { srpSalt: newSrpSalt, srpVerifier: newSrpVerifier } = generateRegistrationData(newSrpKey);

      // Re-encrypt private keys with new password
      setStep("Re-encrypting private keys...");
      const keypairs = {
        encryptionPublicKey: currentKeys.encryptionPublicKey,
        encryptionPrivateKey: currentKeys.encryptionPrivateKey,
        signingPublicKey: currentKeys.signingPublicKey,
        signingPrivateKey: currentKeys.signingPrivateKey,
      };
      const newEncryptedUserData = encryptUserData(keypairs, newPds);

      // Generate new recovery key
      setStep("Generating new recovery key...");
      const newRecoveryKey = generateRecoveryKey();
      const newRecoveryEncryptedData = encryptWithRecoveryKey(keypairs, newRecoveryKey);
      const newRecoveryKeyHash = await hashRecoveryKey(newRecoveryKey);

      // Update server
      setStep("Updating password...");
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newSrpSalt,
          newSrpVerifier,
          newArgon2Salt: toBase64(newArgon2Salt),
          newEncryptedUserData: JSON.stringify(newEncryptedUserData),
          newRecoveryKeyHash,
          newRecoveryEncryptedData: JSON.stringify(newRecoveryEncryptedData),
        }),
      });

      if (!res.ok) {
        setError("Failed to change password");
        return;
      }

      // Re-seal the lock cache under the new password-derived key.
      // The previous blob was encrypted under the OLD unlockCacheKey
      // and is no longer recoverable from the new password.
      clearLockCache();
    clearMetadataCache();
      saveLockCache({
        email,
        argon2Salt: toBase64(newArgon2Salt),
        keys: {
          encryptionPublicKey: keypairs.encryptionPublicKey,
          encryptionPrivateKey: keypairs.encryptionPrivateKey,
          signingPublicKey: keypairs.signingPublicKey,
          signingPrivateKey: keypairs.signingPrivateKey,
        },
        unlockCacheKey: newUnlockCacheKey,
      });
      newUnlockCacheKey.fill(0);

      setState({ loading: false, error: null, step: null, recoveryKey: newRecoveryKey, userKeys: { ...keypairs, email }, suspended: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Password change failed";
      setError(message);
    }
  }

  /**
   * Fast tab-reopen path: re-derive the in-memory keys from the
   * local lock cache using the password alone. Runs a local Argon2id
   * + HKDF chain — never hits the server. Used by `auth-screen.tsx`
   * when `readLockCacheMeta()` returns a cached user.
   */
  async function unlock(password: string) {
    const meta = readLockCacheMeta();
    if (!meta) {
      setError("No cached session on this device. Please sign in.");
      return;
    }
    setState({
      loading: true,
      error: null,
      step: "Unlocking…",
      recoveryKey: null,
      userKeys: null,
      suspended: null,
    });

    try {
      // Re-derive the same HKDF chain the login flow used originally.
      // `argon2Salt` was captured at login time and persisted alongside
      // the blob — it's not a secret, it's the same salt the server
      // sends on login/init.
      setStep("Deriving master key…");
      const argon2SaltBytes = fromBase64(meta.argon2Salt);
      const masterKey = await deriveMainKey(password, argon2SaltBytes);
      const { unlockCacheKey } = splitMasterKey(masterKey);

      setStep("Unsealing…");
      let payload;
      try {
        payload = unlockKeys(unlockCacheKey);
      } finally {
        unlockCacheKey.fill(0);
      }

      const keys: UserKeys = {
        ...payload,
        email: meta.email,
      };
      sessionStorage.setItem("securewarp_keys", JSON.stringify(keys));
      window.dispatchEvent(new Event("securewarp-keys-updated"));

      // Check if the server session is still valid. If the JWT
      // expired, run a full SRP handshake (without Turnstile) to
      // get a fresh JWT. The user already proved they know the
      // password via Argon2 + lock cache unseal.
      const sessionRes = await fetch("/api/auth/session");
      if (!sessionRes.ok) {
        setStep("Refreshing session...");
        // Re-derive SRP key from the same master key chain
        const masterKey2 = await deriveMainKey(password, fromBase64(meta.argon2Salt));
        const { srpKey: srpKey2 } = splitMasterKey(masterKey2);

        const { generateClientEphemeral, deriveClientSession, verifyServerProof } = await import("@/lib/srp/client");
        const { clientSecretEphemeral, clientPublicEphemeral } = generateClientEphemeral();

        // Init (no Turnstile)
        const initRes = await fetch("/api/auth/login/init-refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: meta.email, clientPublicEphemeral }),
        });
        const initData = await initRes.json();
        if (!initRes.ok) throw new Error(initData.error || "Session refresh failed");

        // Derive + verify
        const { clientSession, clientProof } = deriveClientSession(
          clientSecretEphemeral,
          clientPublicEphemeral,
          initData.serverPublicEphemeral,
          initData.srpSalt,
          srpKey2
        );

        const verifyRes = await fetch("/api/auth/login/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ srpSessionId: initData.srpSessionId, clientProof }),
        });
        const verifyData = await verifyRes.json();
        if (!verifyRes.ok) throw new Error(verifyData.error || "Session refresh failed");

        verifyServerProof(clientPublicEphemeral, clientSession, verifyData.serverProof);
        // JWT is now set via the verify endpoint's createSession call
      }

      setState({
        loading: false,
        error: null,
        step: null,
        recoveryKey: null,
        userKeys: keys,
        suspended: null,
      });
      router.push("/drive");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unlock failed";
      setError(message.includes("Wrong") ? "Wrong password" : message);
    }
  }

  async function logout() {
    sessionStorage.removeItem("securewarp_keys");
    // Wipe the local lock cache too — otherwise the next visit would
    // silently unlock without a fresh login. "Log out" means
    // log out, not "lock."
    clearLockCache();
    clearMetadataCache();
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function dismissRecoveryKey() {
    setState((s) => ({ ...s, recoveryKey: null }));
    // Fresh signup lands on /welcome — the wizard handles display name +
    // optional workspace and calls /api/auth/onboarding/complete, then
    // bounces to /drive. Returning users (post-onboarding) never hit
    // dismissRecoveryKey, so this path is only reached at first signup.
    router.push("/welcome");
  }

  return {
    ...state,
    signup,
    login,
    unlock,
    recover,
    changePassword,
    logout,
    dismissRecoveryKey,
  };
}
