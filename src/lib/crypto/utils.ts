import nacl from "tweetnacl";
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from "tweetnacl-util";

export function toBase64(bytes: Uint8Array): string {
  return encodeBase64(bytes);
}

export function fromBase64(str: string): Uint8Array {
  return decodeBase64(str);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

export function randomBytes(length: number): Uint8Array {
  return nacl.randomBytes(length);
}

export function utf8Encode(str: string): Uint8Array {
  return decodeUTF8(str);
}

export function utf8Decode(bytes: Uint8Array): string {
  return encodeUTF8(bytes);
}
