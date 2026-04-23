# Multi-bucket chunk sharding — design

**Status:** proposed, not implemented.
**Author:** Claude, 2026-04-22.
**Context:** upload/download throughput is pinned at ~15 MB/s aggregate
because all 5 concurrent chunk streams multiplex over a single HTTP/2 TCP
connection to `*.r2.cloudflarestorage.com`. Sharding chunks across N R2
buckets — each with its own hostname — gives the browser N independent
TCP connections, breaking that ceiling.

## Zero-knowledge is preserved

Nothing about the crypto changes. Chunks are still XChaCha20-Poly1305
encrypted in the browser with a per-file session key, wrapped into the
hierarchical key tree exactly as today. The server never sees plaintext,
and it still never sees plaintext in the sharded design. The ONLY change
is which R2 bucket holds a given ciphertext chunk.

Invariant check: AGENTS.md's "Client-side primitives are fixed" list is
unchanged. AGENTS.md's "Crypto is the product" section is unchanged.
No crypto-v3 migration.

## Model

### Shard count

Pick **N = 5** shards — matches `CONCURRENT_CHUNK_UPLOADS = 5` so each
in-flight chunk at steady state hits a distinct hostname. Larger N is
harmless but adds operational surface (bucket creation, CORS config,
quota monitoring); smaller N brings back multiplexing.

### Shard assignment

Deterministic round-robin by chunk index:

```
shardIndex = chunkIndex % SHARD_COUNT
```

No hashing needed — we already have a natural per-chunk index and the
distribution is perfectly even. Deterministic so the server can
regenerate the correct URL for any chunk without storing the mapping
elsewhere (though we still store it explicitly for ops safety).

### Storage key format

Unchanged from today:

```
{userId}/{fileId}/v{versionNumber}/chunk-{sequence}
```

The shard is **not** encoded in the key. The same key string is unique
within a bucket, and `(bucket, key)` is unique globally. Keeping the key
format stable means the only net new data is one integer column.

## Schema change

Single column addition to `file_chunks`:

```sql
ALTER TABLE file_chunks
  ADD COLUMN shard SMALLINT NOT NULL DEFAULT 0;

CREATE INDEX file_chunks_shard_idx ON file_chunks(shard);
```

Default 0 preserves backwards-compatibility with any pre-existing rows
(they continue reading from the `securewarp-shard-0` bucket, which we
create as a rename of today's `securewarp` bucket; see Migration).

Per AGENTS.md: apply the DDL to both prod Supabase and test Supabase.
Document in README.md's migrations block.

## Infrastructure

### R2 buckets

Create 5 buckets in the same WNAM location as the current one:

```
securewarp-shard-0  (alias of current `securewarp`; see Migration)
securewarp-shard-1
securewarp-shard-2
securewarp-shard-3
securewarp-shard-4
```

All Standard storage class, default jurisdiction, same CORS config as
today (same origin permissions for `https://securewarp.com` +
`https://www.securewarp.com`). Lifecycle rule parity (the
`upload_complete=false` cleanup cron uses a 24h age threshold against
object lifecycle rules).

### Cloudflare Worker bindings

`wrangler.jsonc` gains 5 R2 bucket bindings. Actually — we don't need
bindings because we mint presigned URLs via the S3 SDK, not via Worker
R2 bindings. Drop the binding idea. The S3 SDK talks to each bucket by
name using the same account-level access key/secret.

## Code changes

### `src/lib/db/r2.ts`

- Export `SHARD_COUNT = 5`.
- Export `shardForChunk(sequence: number): number` returning `sequence % SHARD_COUNT`.
- Export `bucketForShard(shard: number): string` returning `securewarp-shard-${shard}`.
- Change `getUploadUrl(storageKey)` → `getUploadUrl(shard, storageKey)`: the
  SigV4 signer uses the shard's bucket name when constructing the URL.
- Change `getDownloadUrl(storageKey)` → `getDownloadUrl(shard, storageKey)`.

### `src/lib/db/files.ts`

- `createFileChunk(...)` gains a `shard` parameter, persists to the new
  column.
- `getChunksForFile(...)` SELECT gains `shard`.
- `deleteFileVersion(...)` → returns `{shard, storageKey}[]` for orphan
  cleanup, grouped by shard.
- `purgeItem(...)` / `emptyTrash(...)` — same shape change to their
  orphan returns.

### `src/app/api/files/chunk-upload/route.ts`

Three affected actions:

1. **init** (`POST action:init`): when minting N presigned upload URLs,
   compute `shard = i % SHARD_COUNT` for each and return
   `{sequence, shard, storageKey, uploadUrl}[]` to the client.
2. **chunk** (`POST action:chunk`): accept `shard` in the body, persist
   to `file_chunks.shard`.
3. **refresh-urls** (`POST action:refresh-urls`): when re-minting URLs
   for retry, pass the chunk's stored `shard` back into
   `getUploadUrl(shard, ...)`.

### `src/app/api/files/chunk-download/route.ts`

Read `shard` from `file_chunks` rows, pass to `getDownloadUrl(shard, ...)`.
Return in the per-chunk response shape unchanged externally — the URL
it returns just happens to point at a different hostname.

### `src/app/api/files/[id]/rotate-init/route.ts` and `rotate-commit`

Rotate follows the same pattern as initial upload: mint URLs across
shards on init, persist shard on commit.

### `src/app/api/files/link/[id]/download/route.ts`

Same as chunk-download — per-chunk shard → correct hostname.

### Deletion paths

- `src/app/api/files/purge/route.ts`
- `src/app/api/files/trash/empty/route.ts`
- `src/app/api/auth/delete-account/route.ts`
- `src/app/api/admin/users/[id]/delete/route.ts`
- `src/app/api/admin/cleanup-stale/route.ts`

Current pattern: collect `storageKey[]` from DB, call
`r2Client.deleteObjects({ Bucket: "securewarp", Delete: {...} })`.

New pattern: collect `{shard, storageKey}[]`, group by shard, issue one
`deleteObjects` per bucket.

### Orphan / ref-counting helper

`collectOrphanedKeys(...)` in `files.ts` currently joins on
`storage_key`. Needs to group by `(shard, storage_key)` composite. The
logic (count references across all `file_chunks` and `files` rows,
collect keys where count drops to zero) is unchanged; just keyed on a
tuple instead of a string.

### Client changes — minimal

`src/hooks/use-files.ts`:

- Upload paths (`uploadFile`, `replaceFile`, rotate): the init response
  already returns a list of `chunkUrls`. Each entry now carries `shard`
  alongside `storageKey` and `uploadUrl`. The client passes `shard` back
  when registering the chunk. That's it — the PUT URL itself already
  points at the correct bucket host.

- Download paths (`downloadFile`, `previewFile`, share page, bulk zip):
  the server-returned chunks list carries pre-signed URLs pointing at
  per-shard hostnames. Client fetches them unchanged.

## Migration

With 2 prod accounts whose data is recreatable, the simplest path:

1. Create `securewarp-shard-1` through `securewarp-shard-4` via wrangler.
2. Rename `securewarp` → `securewarp-shard-0` (wrangler r2 bucket rename,
   if supported — otherwise create shard-0 and leave legacy empty).
3. Apply DDL (`ADD COLUMN shard`) to both Supabase projects.
4. Wipe existing `file_chunks` + `files` rows + R2 objects for the 2
   accounts (sign out, delete account, re-signup after deploy).
5. Deploy code.

If we ever need a real users migration:

1. Deploy schema + code with `shard` column defaulting to 0 (reads from
   shard-0 continue to work because legacy data is in that bucket).
2. New uploads go to shards 0..4 per round-robin.
3. Background migration: scan `file_chunks WHERE shard=0`, redistribute
   per round-robin using `S3 CopyObject` (intra-account, free bandwidth),
   update `shard` column, verify, delete from shard-0.

## Risk & ops

| Risk | Mitigation |
|---|---|
| One shard hits Class A rate limit while others idle | Round-robin distributes writes evenly; hotspotting is extremely unlikely |
| Partial upload leaves orphans in one shard | Cleanup-stale cron already sweeps `upload_complete=false` rows; just needs the grouped-delete change |
| CORS drift between buckets | Write CORS config as terraform/wrangler-managed config, not manual dashboard entry |
| R2 access key rotation | Single account-level key still works; rotation touches all shards atomically |
| Bucket creation fails mid-deploy | Idempotent: bucket-already-exists is a no-op |
| Quota per-bucket | R2 per-account quotas apply across all buckets; aggregate quota unchanged |

## Expected gain

- **Current ceiling**: ~15 MB/s (single HTTP/2 connection to one bucket
  hostname).
- **User's real upstream pipe**: ~53 MB/s (measured via WeTransfer on
  the same session).
- **5-shard theoretical**: ~53 MB/s (user's pipe becomes the ceiling).
- **Realistic 5-shard**: ~35-45 MB/s aggregate (2.3-3× current),
  assuming each TCP connection reaches its share of the real pipe.

Diminishing returns past 5 shards since the user's pipe caps aggregate
regardless of how we slice it.

## Cost

**Cloudflare R2 billing: $0 net change.** Storage, Class A ops, Class B
ops, and egress are all priced per-account-aggregate, not per-bucket.

**Engineering: ~1 developer-day of focused work + careful testing.**
Not a weekend — the storage layout is load-bearing and the delete paths
have to be right. Files are easy to lose if cleanup routes the wrong
way.

**Operational: 5 buckets instead of 1 to monitor.** Low ongoing cost;
CF dashboard handles fine.

## What I'd recommend gating on

Before building: decide whether 15 MB/s is actually a business problem.
SecureWarp at 15 MB/s is already competitive with every other
E2E-encrypted drive (Proton 15-30, Filen 10-20, Tresorit 10-25, Sync.com
15-25 — see the benchmark table in our earlier session notes). The 2-3×
win from sharding only matters if:

- Users complain about upload speed as a top friction point.
- We're going after a user segment (video professionals, large-file
  backup) where 15 MB/s is genuinely insufficient.
- We've shipped the other higher-leverage features (mobile apps,
  sharing UX polish, billing quality-of-life) and this is the next
  obvious thing.

If any of those are true, ship this. If not, park it in docs/ and move on.
