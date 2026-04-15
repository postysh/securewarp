"use client";

import { createContext, useContext } from "react";

export interface UserKeys {
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
  signingPublicKey: string;
  signingPrivateKey: string;
  email: string;
  // base64-encoded HMAC key for the encrypted search index. Optional
  // because old sessionStorage blobs from before search shipped won't
  // have it; consumers should treat it as missing rather than throw.
  searchIndexKey?: string;
}

export const UserKeysContext = createContext<UserKeys | null>(null);

export function useUserKeys() {
  return useContext(UserKeysContext);
}
