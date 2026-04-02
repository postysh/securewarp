/**
 * SRP-6a server — wraps secure-remote-password/server.
 *
 * Runs server-side only (API routes).
 */

import "server-only";
import * as srpServer from "secure-remote-password/server";

/**
 * Login Step 2: generate server ephemeral from stored verifier.
 */
export function generateServerEphemeral(verifier: string): {
  serverSecretEphemeral: string;
  serverPublicEphemeral: string;
} {
  const ephemeral = srpServer.generateEphemeral(verifier);
  return {
    serverSecretEphemeral: ephemeral.secret,
    serverPublicEphemeral: ephemeral.public,
  };
}

/**
 * Login Step 4: derive server session and verify client proof (M1).
 * Returns M2 (server proof) to send back to client.
 */
export function verifyClientAndDeriveSession(
  serverSecretEphemeral: string,
  clientPublicEphemeral: string,
  srpSalt: string,
  verifier: string,
  clientProof: string
): {
  serverProof: string;
} {
  const serverSession = srpServer.deriveSession(
    serverSecretEphemeral,
    clientPublicEphemeral,
    srpSalt,
    "securewarp-user",
    verifier,
    clientProof
  );

  return {
    serverProof: serverSession.proof,
  };
}
