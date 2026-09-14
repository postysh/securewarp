import { describe, it, expect } from "vitest";
import {
  chunkStorageKey,
  isChunkStorageKeyFor,
  parseChunkStorageKey,
} from "./storage-key";

const OWNER = "11111111-1111-4111-8111-111111111111";
const FILE = "22222222-2222-4222-8222-222222222222";
const OTHER_OWNER = "33333333-3333-4333-8333-333333333333";
const OTHER_FILE = "44444444-4444-4444-8444-444444444444";

describe("chunkStorageKey", () => {
  it("mints the canonical layout for integer version numbers", () => {
    expect(chunkStorageKey(OWNER, FILE, 1, 0)).toBe(`${OWNER}/${FILE}/v1/chunk-0`);
    expect(chunkStorageKey(OWNER, FILE, 12, 7)).toBe(`${OWNER}/${FILE}/v12/chunk-7`);
  });

  it("mints the canonical layout for base36 rotation tags", () => {
    const tag = (1_700_000_000_000).toString(36);
    expect(chunkStorageKey(OWNER, FILE, tag, 3)).toBe(`${OWNER}/${FILE}/v${tag}/chunk-3`);
  });

  it("rejects malformed tags and sequences", () => {
    expect(() => chunkStorageKey(OWNER, FILE, "a/b", 0)).toThrow();
    expect(() => chunkStorageKey(OWNER, FILE, "", 0)).toThrow();
    expect(() => chunkStorageKey(OWNER, FILE, 1, -1)).toThrow();
    expect(() => chunkStorageKey(OWNER, FILE, 1, 1.5)).toThrow();
  });
});

describe("parseChunkStorageKey", () => {
  it("round-trips a minted key", () => {
    const key = chunkStorageKey(OWNER, FILE, 4, 9);
    expect(parseChunkStorageKey(key)).toEqual({
      ownerUserId: OWNER,
      fileId: FILE,
      versionTag: "4",
      sequence: 9,
    });
  });

  it.each([
    "",
    "/",
    `/${OWNER}/${FILE}/v1/chunk-0`,
    `${OWNER}/${FILE}/v1/chunk-0/`,
    `${OWNER}/${FILE}/v1`,
    `${OWNER}/${FILE}/v1/chunk-0/extra`,
    `${OWNER}//v1/chunk-0`,
    `${OWNER}/../v1/chunk-0`,
    `${OWNER}/${FILE}/1/chunk-0`,
    `${OWNER}/${FILE}/v/chunk-0`,
    `${OWNER}/${FILE}/vA/chunk-0`,
    `${OWNER}/${FILE}/v1/chunk-`,
    `${OWNER}/${FILE}/v1/chunk-01`,
    `${OWNER}/${FILE}/v1/chunk--1`,
    `${OWNER}/${FILE}/v1/chunk-0?x=1`,
    `${OWNER}/${FILE}/v1/blob-0`,
  ])("rejects %j", (key) => {
    expect(parseChunkStorageKey(key)).toBeNull();
  });
});

describe("isChunkStorageKeyFor", () => {
  const key = chunkStorageKey(OWNER, FILE, 2, 5);

  it("accepts the exact (owner, file, version, sequence) it was minted for", () => {
    expect(isChunkStorageKeyFor(key, { ownerUserId: OWNER, fileId: FILE, sequence: 5, versionTag: 2 })).toBe(true);
    expect(isChunkStorageKeyFor(key, { ownerUserId: OWNER, fileId: FILE, sequence: 5, versionTag: "2" })).toBe(true);
  });

  it("accepts any well-formed tag when versionTag is omitted (rotation)", () => {
    expect(isChunkStorageKeyFor(key, { ownerUserId: OWNER, fileId: FILE, sequence: 5 })).toBe(true);
  });

  it("rejects a key minted for another tenant's file", () => {
    // The cross-tenant case: attacker owns FILE, references victim's blob.
    const victim = chunkStorageKey(OTHER_OWNER, OTHER_FILE, 1, 0);
    expect(isChunkStorageKeyFor(victim, { ownerUserId: OWNER, fileId: FILE, sequence: 0 })).toBe(false);
  });

  it("rejects a key for another file owned by the same user", () => {
    const sibling = chunkStorageKey(OWNER, OTHER_FILE, 1, 0);
    expect(isChunkStorageKeyFor(sibling, { ownerUserId: OWNER, fileId: FILE, sequence: 0 })).toBe(false);
  });

  it("rejects sequence and version mismatches", () => {
    expect(isChunkStorageKeyFor(key, { ownerUserId: OWNER, fileId: FILE, sequence: 4, versionTag: 2 })).toBe(false);
    expect(isChunkStorageKeyFor(key, { ownerUserId: OWNER, fileId: FILE, sequence: 5, versionTag: 3 })).toBe(false);
  });

  it("rejects prefix-only matches", () => {
    expect(
      isChunkStorageKeyFor(`${OWNER}/${FILE}/v2/chunk-5/../../${OTHER_FILE}/v1/chunk-0`, {
        ownerUserId: OWNER,
        fileId: FILE,
        sequence: 5,
      })
    ).toBe(false);
  });
});
