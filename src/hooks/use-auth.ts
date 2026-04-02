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

interface AuthState {
  loading: boolean;
  error: string | null;
  step: string | null;
  recoveryKey: string | null;
}

export function useAuth() {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    loading: false,
    error: null,
    step: null,
    recoveryKey: null,
  });

  const setStep = (step: string) => setState((s) => ({ ...s, step, error: null }));
  const setError = (error: string) => setState((s) => ({ ...s, error, loading: false, step: null }));

  async function signup(email: string, password: string) {
    setState({ loading: true, error: null, step: "Generating encryption keys...", recoveryKey: null });

    try {
      // 1. Generate Argon2 salt and derive master key
      setStep("Deriving master key...");
      const argon2Salt = randomBytes(16);
      const masterKey = await deriveMainKey(password, argon2Salt);

      // 2. Split into SRP key + password-derived secret
      setStep("Splitting keys...");
      const { srpKey, passwordDerivedSecret } = splitMasterKey(masterKey);

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
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        setError(result.error || "Registration failed");
        return;
      }

      // Success — store recovery key for display
      setState({ loading: false, error: null, step: null, recoveryKey });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Signup failed";
      setError(message);
    }
  }

  async function login(email: string, password: string) {
    setState({ loading: true, error: null, step: "Initializing...", recoveryKey: null });

    try {
      // 1. Generate client ephemeral
      setStep("Generating ephemeral...");
      const { clientSecretEphemeral, clientPublicEphemeral } = generateClientEphemeral();

      // 2. Send to server, get salt + server ephemeral
      setStep("Contacting server...");
      const initRes = await fetch("/api/auth/login/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, clientPublicEphemeral }),
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

      // 4. Split into SRP key + password-derived secret
      const { srpKey, passwordDerivedSecret } = splitMasterKey(masterKey);

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

      decryptUserData(encryptedData, passwordDerivedSecret);

      // Success — navigate to drive
      setState({ loading: false, error: null, step: null, recoveryKey: null });
      router.push("/drive");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
    }
  }

  async function recover(email: string, recoveryWordsRaw: string, newPassword: string) {
    setState({ loading: true, error: null, step: "Verifying recovery key...", recoveryKey: null });

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
        body: JSON.stringify({ action: "verify", email, recoveryKeyHash }),
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
      const { srpKey: newSrpKey, passwordDerivedSecret: newPds } = splitMasterKey(newMasterKey);
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
        setError(updateResult.error || "Recovery update failed");
        return;
      }

      // Success — show new recovery key
      setState({ loading: false, error: null, step: null, recoveryKey: newRecoveryKey });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Recovery failed";
      setError(message);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function dismissRecoveryKey() {
    setState((s) => ({ ...s, recoveryKey: null }));
    router.push("/drive");
  }

  return {
    ...state,
    signup,
    login,
    recover,
    logout,
    dismissRecoveryKey,
  };
}
