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
  // Set when login/verify returns requires2FA=true. Holds the
  // pending state so the client can prompt for the TOTP code then
  // call verify2FA() to complete the login.
  pending2FA: {
    srpSessionId: string;
    keys: UserKeys;
    email: string;
    argon2Salt: string;
    unlockCacheKey: Uint8Array;
  } | null;
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
    pending2FA: null,
  });

  const setStep = (step: string) => setState((s) => ({ ...s, step, error: null }));
  const setError = (error: string) => setState((s) => ({ ...s, error, loading: false, step: null }));
  const setSuspended = (reason: string | null) =>
    setState((s) => ({ ...s, suspended: { reason }, loading: false, step: null, error: null }));

  async function signup(email: string, password: string, turnstileToken?: string) {
    setState({ loading: true, error: null, step: "Generating encryption keys...", recoveryKey: null, userKeys: null, suspended: null, pending2FA: null });

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
          publicKemKey: keypairs.kemPublicKey,
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

      // Store keys in sessionStorage (in-memory for this tab).
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
          kemPublicKey: keypairs.kemPublicKey,
          kemPrivateKey: keypairs.kemPrivateKey,
        },
        unlockCacheKey,
      });
      unlockCacheKey.fill(0);

      // Success — store keys and recovery key for display
      setState({
        loading: false, error: null, step: null, recoveryKey,
        userKeys: keys, suspended: null, pending2FA: null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Signup failed";
      setError(message);
    }
  }

  async function login(email: string, password: string, turnstileToken?: string) {
    setState({ loading: true, error: null, step: "Initializing...", recoveryKey: null, userKeys: null, suspended: null, pending2FA: null });

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

      // 4. Split into SRP key + password-derived secret + unlock cache key + search index key
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

      const keys: UserKeys = {
        encryptionPublicKey: verifyData.publicEncryptionKey,
        encryptionPrivateKey: privateKeys.encryptionPrivateKey,
        kemPublicKey: verifyData.publicKemKey,
        kemPrivateKey: privateKeys.kemPrivateKey,
        email,
      };

      // ── 2FA gate ──────────────────────────────────────────────
      // If the server said requires2FA, pause here. Store the
      // pending state so the UI can prompt for the TOTP code, then
      // resume via verify2FA(). The keys and unlockCacheKey are held
      // in state (not persisted yet) so they can be committed after
      // the code checks out.
      if (verifyData.requires2FA) {
        setState({
          loading: false,
          error: null,
          step: null,
          recoveryKey: null,
          userKeys: null,
          suspended: null,
          pending2FA: {
            srpSessionId: verifyData.srpSessionId,
            keys,
            email,
            argon2Salt,
            unlockCacheKey,
          },
        });
        return;
      }

      // No 2FA — finalize immediately.
      sessionStorage.setItem("securewarp_keys", JSON.stringify(keys));
      window.dispatchEvent(new Event("securewarp-keys-updated"));

      saveLockCache({
        email,
        argon2Salt,
        keys: {
          encryptionPublicKey: keys.encryptionPublicKey,
          encryptionPrivateKey: keys.encryptionPrivateKey,
          kemPublicKey: keys.kemPublicKey,
          kemPrivateKey: keys.kemPrivateKey,
        },
        unlockCacheKey,
      });
      unlockCacheKey.fill(0);

      setState({ loading: false, error: null, step: null, recoveryKey: null, userKeys: keys, suspended: null, pending2FA: null });
      router.push("/drive");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
    }
  }

  /**
   * Complete the login after the user enters a valid TOTP code.
   * Called only when `state.pending2FA` is set (i.e. SRP passed but
   * the server returned `requires2FA: true`). Posts the code +
   * srpSessionId to the server; on success, finalizes sessionStorage
   * + lock cache exactly as the non-2FA path does.
   */
  async function verify2FA(code: string) {
    const pending = state.pending2FA;
    if (!pending) {
      setError("No pending 2FA session.");
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null, step: "Verifying code..." }));
    try {
      const res = await fetch("/api/auth/login/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          srpSessionId: pending.srpSessionId,
          code,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Verification failed");
        return;
      }

      // Finalize: same as the non-2FA success path.
      sessionStorage.setItem("securewarp_keys", JSON.stringify(pending.keys));
      window.dispatchEvent(new Event("securewarp-keys-updated"));

      // Only re-save the lock cache if we have a real unlockCacheKey.
      // The unlock→2FA path passes an empty key because the original
      // was zeroed after unsealing — but the lock cache blob from the
      // previous login is still intact, so skipping the re-save is
      // safe. Sealing under an empty key would corrupt the blob and
      // break the next tab reopen.
      if (pending.unlockCacheKey.length > 0) {
        saveLockCache({
          email: pending.email,
          argon2Salt: pending.argon2Salt,
          keys: {
            encryptionPublicKey: pending.keys.encryptionPublicKey,
            encryptionPrivateKey: pending.keys.encryptionPrivateKey,
            kemPublicKey: pending.keys.kemPublicKey,
            kemPrivateKey: pending.keys.kemPrivateKey,
          },
          unlockCacheKey: pending.unlockCacheKey,
        });
        pending.unlockCacheKey.fill(0);
      }

      // Full page navigation, not router.push. The client-side
      // navigation races with the setState({pending2FA: null}) re-
      // render: React shows the login form for a frame before the
      // navigation kicks in, and the user sees a "loop." A real
      // navigation ensures the cookie from verify-2fa is fully
      // committed and sessionStorage is read fresh on the new page.
      window.location.replace("/drive");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Verification failed";
      setError(message);
    }
  }

  async function recover(email: string, recoveryWordsRaw: string, newPassword: string, turnstileToken?: string) {
    setState({ loading: true, error: null, step: "Verifying recovery key...", recoveryKey: null, userKeys: null, suspended: null, pending2FA: null });

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

      // 5. Re-encrypt private keys with new password-derived secret.
      // `encryptionPublicKey` / `kemPublicKey` are intentional
      // placeholders — public keys stored server-side (on the users
      // row) don't change during a password change/recovery, only the
      // at-rest ciphertext protecting the privates changes.
      setStep("Re-encrypting with new password...");
      const keypairs = {
        encryptionPublicKey: "recovered",
        encryptionPrivateKey: privateKeys.encryptionPrivateKey,
        kemPublicKey: "recovered",
        kemPrivateKey: privateKeys.kemPrivateKey,
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
        kemPublicKey: "recovered",
        kemPrivateKey: privateKeys.kemPrivateKey,
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
          kemPublicKey: "recovered",
          kemPrivateKey: privateKeys.kemPrivateKey,
        },
        unlockCacheKey: newUnlockCacheKey,
      });
      newUnlockCacheKey.fill(0);

      // Success — show new recovery key
      setState({ loading: false, error: null, step: null, recoveryKey: newRecoveryKey, userKeys: recoveredKeys, suspended: null, pending2FA: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Recovery failed";
      setError(message);
    }
  }

  async function changePassword(oldPassword: string, newPassword: string, email: string) {
    setState({ loading: true, error: null, step: "Verifying old password...", recoveryKey: null, userKeys: state.userKeys, suspended: null, pending2FA: null });

    try {
      // Get current keys from sessionStorage
      const storedKeys = sessionStorage.getItem("securewarp_keys");
      if (!storedKeys) {
        setError("Session expired. Please log in again.");
        return;
      }
      const currentKeys = JSON.parse(storedKeys);

      // Fetch the current srpSalt + argon2Salt so we can re-derive
      // the old verifier from the old password. The server checks the
      // old verifier to prove the caller knows the current password —
      // a stolen session alone can't produce it.
      setStep("Verifying identity...");
      const profileRes = await fetch("/api/auth/profile");
      if (!profileRes.ok) {
        setError("Could not verify identity. Please try again.");
        return;
      }
      const profile = await profileRes.json();
      if (!profile.srpSalt || !profile.argon2Salt) {
        setError("Missing auth data. Please sign out and in again.");
        return;
      }

      // Derive old SRP verifier from old password
      const oldArgon2SaltBytes = fromBase64(profile.argon2Salt);
      const oldMasterKey = await deriveMainKey(oldPassword, oldArgon2SaltBytes);
      const { srpKey: oldSrpKey } = splitMasterKey(oldMasterKey);
      const { deriveClientSession: _unused, ...srpClientMod } = await import("@/lib/srp/client");
      void _unused;
      // Re-derive the verifier using the stored srpSalt
      const srpClient = await import("secure-remote-password/client");
      const oldSrpKeyHex = (await import("@/lib/crypto/utils")).toHex(oldSrpKey);
      const oldPrivateKey = srpClient.derivePrivateKey(profile.srpSalt, "securewarp-user", oldSrpKeyHex);
      const oldSrpVerifier = srpClient.deriveVerifier(oldPrivateKey);

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
        kemPublicKey: currentKeys.kemPublicKey,
        kemPrivateKey: currentKeys.kemPrivateKey,
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
          oldSrpVerifier,
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
          kemPublicKey: keypairs.kemPublicKey,
          kemPrivateKey: keypairs.kemPrivateKey,
        },
        unlockCacheKey: newUnlockCacheKey,
      });
      newUnlockCacheKey.fill(0);

      setState({ loading: false, error: null, step: null, recoveryKey: newRecoveryKey, userKeys: { ...keypairs, email }, suspended: null, pending2FA: null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Password change failed";
      setError(message);
    }
  }

  /**
   * Tab-reopen path: re-derive the in-memory keys from the local
   * lock cache using the password alone, then run an SRP handshake
   * against the server so the TOTP gate is honoured. Used by
   * `auth-screen.tsx` when `readLockCacheMeta()` returns a cached
   * user.
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
      pending2FA: null,
    });

    try {
      // Re-derive the same HKDF chain the login flow used originally.
      // `argon2Salt` was captured at login time and persisted alongside
      // the blob — it's not a secret, it's the same salt the server
      // sends on login/init.
      setStep("Deriving master key…");
      const argon2SaltBytes = fromBase64(meta.argon2Salt);
      const masterKey = await deriveMainKey(password, argon2SaltBytes);
      const { srpKey, unlockCacheKey } = splitMasterKey(masterKey);

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
      // Don't write keys to sessionStorage yet. If 2FA is enabled we
      // need to wait for the TOTP code before committing. Writing early
      // leaks decrypted private keys to sessionStorage while the 2FA
      // prompt is still pending.

      // Always run a full SRP re-auth on unlock — even if the JWT
      // cookie is still valid. A valid JWT proves the server trusted
      // *some* prior login, but for 2FA-enabled accounts we want the
      // second factor re-challenged every time the user enters their
      // password on this screen; otherwise a thief with the device
      // password bypasses 2FA entirely as long as the 7-day cookie
      // hasn't expired. The server's `requires2FA` branch on
      // `/login/verify` is the canonical gate — always hit it.
      setStep("Refreshing session...");

      const { generateClientEphemeral, deriveClientSession, verifyServerProof } = await import("@/lib/srp/client");
      const { clientSecretEphemeral, clientPublicEphemeral } = generateClientEphemeral();

      // Init (no Turnstile — we're not a fresh-device login)
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
        srpKey
      );

      const verifyRes = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ srpSessionId: initData.srpSessionId, clientProof }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || "Session refresh failed");

      verifyServerProof(clientPublicEphemeral, clientSession, verifyData.serverProof);

      // If 2FA is enabled, the verify endpoint didn't create a
      // session. Pause here and prompt for the TOTP code, same as
      // the regular login flow. The keys are already unsealed from
      // the lock cache; they'll be committed to sessionStorage
      // after the code verifies.
      if (verifyData.requires2FA) {
        setState({
          loading: false,
          error: null,
          step: null,
          recoveryKey: null,
          userKeys: null,
          suspended: null,
          pending2FA: {
            srpSessionId: verifyData.srpSessionId ?? initData.srpSessionId,
            keys,
            email: meta.email,
            argon2Salt: meta.argon2Salt,
            unlockCacheKey: new Uint8Array(0),
          },
        });
        return;
      }

      // No 2FA — JWT is now set via the verify endpoint's createSession call.
      sessionStorage.setItem("securewarp_keys", JSON.stringify(keys));
      window.dispatchEvent(new Event("securewarp-keys-updated"));

      setState({
        loading: false,
        error: null,
        step: null,
        recoveryKey: null,
        userKeys: keys,
        suspended: null,
        pending2FA: null,
      });
      window.location.replace("/drive");
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
    verify2FA,
    unlock,
    recover,
    changePassword,
    logout,
    dismissRecoveryKey,
  };
}
