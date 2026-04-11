import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { encryptChunk, decryptChunk } from "./chunked-encryption";

function key() {
  return nacl.randomBytes(nacl.secretbox.keyLength);
}

describe("chunked-encryption", () => {
  it("roundtrips a single chunk", () => {
    const sessionKey = key();
    const data = new TextEncoder().encode("hello world, this is a chunk payload.");
    const encrypted = encryptChunk(data, 0, true, sessionKey);
    const decrypted = decryptChunk(encrypted.ciphertext, encrypted.nonce, 0, true, sessionKey);
    expect(new TextDecoder().decode(decrypted)).toBe("hello world, this is a chunk payload.");
  });

  it("roundtrips a multi-chunk sequence in order", () => {
    const sessionKey = key();
    const parts = ["alpha", "bravo", "charlie", "delta"].map((s) => new TextEncoder().encode(s));
    const encrypted = parts.map((data, i) => encryptChunk(data, i, i === parts.length - 1, sessionKey));
    const decoded = encrypted.map((c, i) =>
      new TextDecoder().decode(
        decryptChunk(c.ciphertext, c.nonce, i, i === parts.length - 1, sessionKey)
      )
    );
    expect(decoded).toEqual(["alpha", "bravo", "charlie", "delta"]);
  });

  it("rejects a chunk decrypted with the wrong expected index", () => {
    const sessionKey = key();
    const c = encryptChunk(new Uint8Array([1, 2, 3]), 0, false, sessionKey);
    expect(() => decryptChunk(c.ciphertext, c.nonce, 1, false, sessionKey)).toThrow(
      /reordering detected/
    );
  });

  it("rejects a chunk decrypted with the wrong isFinal flag", () => {
    const sessionKey = key();
    const c = encryptChunk(new Uint8Array([1, 2, 3]), 0, true, sessionKey);
    expect(() => decryptChunk(c.ciphertext, c.nonce, 0, false, sessionKey)).toThrow(
      /truncation detected/
    );
  });

  it("fails to decrypt with the wrong session key", () => {
    const c = encryptChunk(new Uint8Array([1, 2, 3]), 0, true, key());
    expect(() => decryptChunk(c.ciphertext, c.nonce, 0, true, key())).toThrow(/decryption failed/);
  });

  it("detects ciphertext tampering", () => {
    const sessionKey = key();
    const c = encryptChunk(new Uint8Array([1, 2, 3, 4]), 0, true, sessionKey);
    const tampered = new Uint8Array(c.ciphertext);
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => decryptChunk(tampered, c.nonce, 0, true, sessionKey)).toThrow(/decryption failed/);
  });
});
