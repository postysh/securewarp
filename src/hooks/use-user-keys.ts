"use client";

import { createContext, useContext } from "react";

export interface UserKeys {
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
  email: string;
}

export const UserKeysContext = createContext<UserKeys | null>(null);

export function useUserKeys() {
  return useContext(UserKeysContext);
}
