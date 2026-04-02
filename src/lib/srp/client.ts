/**
 * SRP-6a client — wraps secure-remote-password/client.
 *
 * Used in the browser during signup and login.
 */

import * as srpClient from "secure-remote-password/client";
import { toHex, fromHex } from "../crypto/utils";

/**
 * Registration: generate SRP salt + verifier from the derived SRP key.
 */
export function generateRegistrationData(srpKey: Uint8Array): {
  srpSalt: string;
  srpVerifier: string;
} {
  const srpKeyHex = toHex(srpKey);
  const srpSalt = srpClient.generateSalt();
  const privateKey = srpClient.derivePrivateKey(srpSalt, "securewarp-user", srpKeyHex);
  const srpVerifier = srpClient.deriveVerifier(privateKey);

  return { srpSalt, srpVerifier };
}

/**
 * Login Step 1: generate client ephemeral values.
 */
export function generateClientEphemeral(): {
  clientSecretEphemeral: string;
  clientPublicEphemeral: string;
} {
  const ephemeral = srpClient.generateEphemeral();
  return {
    clientSecretEphemeral: ephemeral.secret,
    clientPublicEphemeral: ephemeral.public,
  };
}

/**
 * Login Step 3: derive session from server's response.
 * Returns M1 (client proof) to send to server.
 */
export function deriveClientSession(
  clientSecretEphemeral: string,
  clientPublicEphemeral: string,
  serverPublicEphemeral: string,
  srpSalt: string,
  srpKey: Uint8Array
): {
  clientSession: ReturnType<typeof srpClient.deriveSession>;
  clientPublicEphemeral: string;
  clientProof: string;
} {
  const srpKeyHex = toHex(srpKey);
  const privateKey = srpClient.derivePrivateKey(srpSalt, "securewarp-user", srpKeyHex);
  const clientSession = srpClient.deriveSession(
    clientSecretEphemeral,
    serverPublicEphemeral,
    srpSalt,
    "securewarp-user",
    privateKey
  );

  return {
    clientSession,
    clientPublicEphemeral,
    clientProof: clientSession.proof,
  };
}

/**
 * Login Step 5: verify server's proof (M2).
 */
export function verifyServerProof(
  clientPublicEphemeral: string,
  clientSession: ReturnType<typeof srpClient.deriveSession>,
  serverProof: string
): void {
  srpClient.verifySession(clientPublicEphemeral, clientSession, serverProof);
}
