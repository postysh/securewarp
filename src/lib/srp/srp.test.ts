import { describe, it, expect } from "vitest";
import { generateRegistrationData, generateClientEphemeral, deriveClientSession, verifyServerProof } from "./client";
import { generateServerEphemeral, verifyClientAndDeriveSession } from "./server";
import { randomBytes } from "../crypto/utils";

function srpKey() {
  return randomBytes(32);
}

describe("SRP handshake", () => {
  it("completes a full registration + login round trip", () => {
    // Registration: client derives salt + verifier from its SRP key.
    const key = srpKey();
    const { srpSalt, srpVerifier } = generateRegistrationData(key);

    // Login step 1: client ephemeral.
    const { clientSecretEphemeral, clientPublicEphemeral } = generateClientEphemeral();

    // Login step 2: server ephemeral from stored verifier.
    const { serverSecretEphemeral, serverPublicEphemeral } = generateServerEphemeral(srpVerifier);

    // Login step 3: client derives session + proof M1 using the same SRP key.
    const { clientSession, clientProof } = deriveClientSession(
      clientSecretEphemeral,
      clientPublicEphemeral,
      serverPublicEphemeral,
      srpSalt,
      key
    );

    // Login step 4: server verifies M1 and produces proof M2.
    const { serverProof } = verifyClientAndDeriveSession(
      serverSecretEphemeral,
      clientPublicEphemeral,
      srpSalt,
      srpVerifier,
      clientProof
    );

    // Login step 5: client verifies M2 — throws on mismatch.
    expect(() => verifyServerProof(clientPublicEphemeral, clientSession, serverProof)).not.toThrow();
  });

  it("rejects login with the wrong SRP key (wrong password)", () => {
    const { srpSalt, srpVerifier } = generateRegistrationData(srpKey());
    const { clientSecretEphemeral, clientPublicEphemeral } = generateClientEphemeral();
    const { serverSecretEphemeral, serverPublicEphemeral } = generateServerEphemeral(srpVerifier);

    // Client logs in with a *different* SRP key — proof must fail.
    const { clientProof } = deriveClientSession(
      clientSecretEphemeral,
      clientPublicEphemeral,
      serverPublicEphemeral,
      srpSalt,
      srpKey()
    );

    expect(() =>
      verifyClientAndDeriveSession(
        serverSecretEphemeral,
        clientPublicEphemeral,
        srpSalt,
        srpVerifier,
        clientProof
      )
    ).toThrow();
  });

  it("rejects a tampered server proof at the client", () => {
    const key = srpKey();
    const { srpSalt, srpVerifier } = generateRegistrationData(key);
    const { clientSecretEphemeral, clientPublicEphemeral } = generateClientEphemeral();
    const { serverSecretEphemeral, serverPublicEphemeral } = generateServerEphemeral(srpVerifier);

    const { clientSession, clientProof } = deriveClientSession(
      clientSecretEphemeral,
      clientPublicEphemeral,
      serverPublicEphemeral,
      srpSalt,
      key
    );

    const { serverProof } = verifyClientAndDeriveSession(
      serverSecretEphemeral,
      clientPublicEphemeral,
      srpSalt,
      srpVerifier,
      clientProof
    );

    // Flip one hex nibble in the server proof.
    const tampered = serverProof.slice(0, -1) + (serverProof.endsWith("0") ? "1" : "0");
    expect(() => verifyServerProof(clientPublicEphemeral, clientSession, tampered)).toThrow();
  });

  it("produces a different verifier for each registration even with the same SRP key", () => {
    // The salt is randomly generated, so the verifier must differ between
    // two independent registrations.
    const key = srpKey();
    const a = generateRegistrationData(key);
    const b = generateRegistrationData(key);
    expect(a.srpSalt).not.toBe(b.srpSalt);
    expect(a.srpVerifier).not.toBe(b.srpVerifier);
  });
});
