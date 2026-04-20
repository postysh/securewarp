import { describe, it, expect } from "vitest";
import { toBase64, fromBase64, toHex, fromHex, randomBytes, utf8Encode, utf8Decode } from "./utils";

describe("crypto/utils", () => {
  it("base64 roundtrip preserves bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 254, 255, 127, 128]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it("hex roundtrip preserves bytes", () => {
    const bytes = new Uint8Array([0x00, 0xde, 0xad, 0xbe, 0xef, 0xff]);
    expect(toHex(bytes)).toBe("00deadbeefff");
    expect(fromHex("00deadbeefff")).toEqual(bytes);
  });

  it("utf8 roundtrip preserves non-ASCII text", () => {
    const s = "résumé 🦀 seguridad";
    expect(utf8Decode(utf8Encode(s))).toBe(s);
  });

  it("randomBytes returns the requested length and is non-deterministic", () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
    expect(toBase64(a)).not.toBe(toBase64(b));
  });
});
