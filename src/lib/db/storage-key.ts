/**
 * R2 object-key derivation for encrypted chunks.
 *
 * Every chunk blob lives at
 *
 *   `<ownerUserId>/<fileId>/v<versionTag>/chunk-<sequence>`
 *
 * where `versionTag` is either the integer `file_versions.version_number`
 * (upload paths) or a base36 timestamp minted by `rotate-init`
 * (rotation paths). The prefix binds a key to a specific owner and
 * file, and that binding is a security boundary: `file_chunks.storage_key`
 * is trusted verbatim by chunk-download (presigned GET), trash-empty,
 * purge, rotate-commit and the cleanup crons (DeleteObjects). If a
 * client could record an arbitrary key on its own file, it could read
 * — and, by trashing its own file, delete — another tenant's ciphertext.
 *
 * So the server never stores a client-supplied key without first
 * proving it was minted for (caller, file, sequence). Pure functions,
 * no I/O, so they are unit-testable without the R2 client.
 */

const SEGMENT = /^[0-9a-zA-Z-]+$/;
const VERSION_TAG = /^[0-9a-z]+$/;

export function chunkStorageKey(
  ownerUserId: string,
  fileId: string,
  versionTag: string | number,
  sequence: number
): string {
  const tag = String(versionTag);
  if (!VERSION_TAG.test(tag)) throw new Error(`Invalid version tag: ${tag}`);
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error(`Invalid chunk sequence: ${sequence}`);
  }
  return `${ownerUserId}/${fileId}/v${tag}/chunk-${sequence}`;
}

export interface ParsedChunkStorageKey {
  ownerUserId: string;
  fileId: string;
  versionTag: string;
  sequence: number;
}

/**
 * Strict parse of a chunk key. Returns null for anything that is not
 * exactly four segments in the canonical shape — no leading slash, no
 * empty segments, no `..`, no query/fragment characters, no sequence
 * with leading zeros or sign.
 */
export function parseChunkStorageKey(key: string): ParsedChunkStorageKey | null {
  const parts = key.split("/");
  if (parts.length !== 4) return null;
  const [ownerUserId, fileId, v, chunk] = parts;
  if (!SEGMENT.test(ownerUserId) || !SEGMENT.test(fileId)) return null;
  if (!v.startsWith("v")) return null;
  const versionTag = v.slice(1);
  if (!VERSION_TAG.test(versionTag)) return null;
  const m = /^chunk-(0|[1-9][0-9]*)$/.exec(chunk);
  if (!m) return null;
  const sequence = Number(m[1]);
  if (!Number.isSafeInteger(sequence)) return null;
  return { ownerUserId, fileId, versionTag, sequence };
}

/**
 * True iff `key` was minted for exactly this owner, file and sequence.
 * When `versionTag` is given it must match too (upload paths, where the
 * server knows the version number). When omitted, any well-formed tag
 * is accepted (rotation paths, where the tag is a timestamp the server
 * did not persist) — the owner/file/sequence binding alone is what
 * stops cross-tenant references.
 */
export function isChunkStorageKeyFor(
  key: string,
  expected: { ownerUserId: string; fileId: string; sequence: number; versionTag?: string | number }
): boolean {
  const parsed = parseChunkStorageKey(key);
  if (!parsed) return false;
  if (parsed.ownerUserId !== expected.ownerUserId) return false;
  if (parsed.fileId !== expected.fileId) return false;
  if (parsed.sequence !== expected.sequence) return false;
  if (expected.versionTag !== undefined && parsed.versionTag !== String(expected.versionTag)) {
    return false;
  }
  return true;
}
