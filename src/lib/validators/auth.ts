import { z } from "zod";

export const RegisterSchema = z.object({
  email: z.string().email(),
  srpSalt: z.string().min(1),
  srpVerifier: z.string().min(1),
  argon2Salt: z.string().min(1),
  encryptedUserData: z.object({
    nonce: z.string().min(1),
    ciphertext: z.string().min(1),
  }),
  publicEncryptionKey: z.string().min(1),
  publicSigningKey: z.string().min(1),
  recoveryKeyHash: z.string().optional(),
  recoveryEncryptedData: z.object({
    nonce: z.string().min(1),
    ciphertext: z.string().min(1),
  }).optional(),
  // Optional because Turnstile is gated on an env var — when unset,
  // the server-side verifier treats the request as passing regardless.
  turnstileToken: z.string().optional(),
});

export const LoginInitSchema = z.object({
  email: z.string().email(),
  clientPublicEphemeral: z.string().min(1),
  turnstileToken: z.string().optional(),
});

export const LoginVerifySchema = z.object({
  srpSessionId: z.string().uuid(),
  clientProof: z.string().min(1),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInitInput = z.infer<typeof LoginInitSchema>;
export type LoginVerifyInput = z.infer<typeof LoginVerifySchema>;
