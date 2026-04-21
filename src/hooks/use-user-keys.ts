"use client";

import { createContext, useContext } from "react";

export interface UserKeys {
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
  // Crypto v2 Phase 2a — ML-KEM-768 keypair. Present on every
  // account from 2a onward; DORMANT until 2b starts using it for
  // hybrid wraps. Never empty — account creation fails if either
  // half is missing.
  kemPublicKey: string;
  kemPrivateKey: string;
  email: string;
}

export const UserKeysContext = createContext<UserKeys | null>(null);

export function useUserKeys() {
  return useContext(UserKeysContext);
}
