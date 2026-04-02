declare module "argon2-browser/dist/argon2-bundled.min.js" {
  interface Argon2HashOptions {
    pass: string;
    salt: Uint8Array;
    time: number;
    mem: number;
    parallelism: number;
    hashLen: number;
    type: number;
  }

  interface Argon2HashResult {
    hash: ArrayBuffer;
    hashHex: string;
    encoded: string;
  }

  const argon2: {
    hash(options: Argon2HashOptions): Promise<Argon2HashResult>;
    ArgonType: {
      Argon2d: number;
      Argon2i: number;
      Argon2id: number;
    };
  };

  export default argon2;
}
