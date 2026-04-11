# SecureWarp

End-to-end encrypted cloud storage. Zero-knowledge architecture. You hold the keys.

## What is SecureWarp?

SecureWarp is a private cloud drive where files are encrypted in your browser before they ever leave your device. The server only stores ciphertext — it cannot read your files, filenames, or metadata. Even we can't see your data.

## Encryption Architecture

```
Password
  → Argon2id (64 MB, 3 iterations)
    → HKDF-SHA256
      → SRP key (zero-knowledge authentication)
      → Password-derived secret (encrypts private keys)

File Upload
  → Random session key per file
  → xsalsa20-poly1305 (encrypt content in 50 MB chunks)
  → Authenticated chunks (sequence + isFinal prevents tampering)
  → Session key encrypted with recipient's Curve25519 public key
  → Encrypted blob uploaded directly to R2 (server never touches plaintext)
```

### Cryptographic Primitives

| Primitive | Usage |
|-----------|-------|
| **Curve25519** | Asymmetric encryption keypairs |
| **Ed25519** | Digital signatures |
| **xsalsa20-poly1305** | Symmetric file + metadata encryption |
| **Argon2id** | Password-based key derivation |
| **HKDF-SHA256** | Key splitting (auth key + encryption key) |
| **SRP-6a** | Zero-knowledge password authentication |
| **BIP39** | 24-word mnemonic recovery keys |

### Zero-Knowledge Auth (SRP-6a)

Your password never leaves your browser — not even as a hash. The SRP protocol proves you know the password without revealing it. The server stores a verifier that cannot be reversed into the password.

### Recovery Keys

Recovery keys use HKDF to derive separate verification and encryption keys from the BIP39 mnemonic. The server stores a hash of the verification key (not the encryption key), so even a database breach cannot decrypt recovery-encrypted data.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16 (App Router) |
| **Frontend** | React 19, Tailwind CSS 4, TypeScript |
| **Icons** | Hugeicons |
| **Client Crypto** | tweetnacl, argon2-browser (WASM), @noble/hashes, bip39 |
| **Auth Protocol** | secure-remote-password (SRP-6a) |
| **Sessions** | jose (JWT), HttpOnly cookies |
| **Database** | Supabase Postgres (service-role, no Supabase Auth) |
| **File Storage** | Cloudflare R2 (S3-compatible, zero egress fees) |
| **Validation** | Zod |
| **Deployment** | Vercel |

## Project Structure

```
src/
├── app/
│   ├── (marketing)/     Landing page
│   ├── api/auth/        SRP auth endpoints (register, login, recover, etc.)
│   ├── api/files/       File operations (upload, download, list, delete, chunks)
│   ├── drive/           Main dashboard
│   ├── login/           Sign in
│   └── signup/          Sign up
├── components/          UI components (sidebar, file browser, modals, etc.)
├── hooks/
│   ├── use-auth.ts      SRP signup/login/recover/change-password orchestration
│   ├── use-files.ts     Chunked encrypt/upload/download/delete
│   └── use-user-keys.ts Decrypted key context
├── lib/
│   ├── auth/            JWT sessions, rate limiting
│   ├── crypto/          Argon2id, HKDF, keypairs, file encryption, chunked encryption
│   ├── db/              Supabase client, users, files, R2
│   ├── srp/             SRP-6a client + server wrappers
│   └── validators/      Zod schemas
└── middleware.ts        Route protection
```

## Security

- **Timing-safe comparisons** on recovery key hash verification
- **Rate limiting** on login (10/hr) and recovery (5/hr) endpoints
- **Single-use recovery tokens** with JTI tracking
- **Session secret minimum** 32 characters enforced
- **Generic error messages** to prevent information leakage
- **Email enumeration prevention** on registration
- **SRP session cleanup** on every query
- **HKDF salt** on all key derivation (not undefined)
- **Chunked file auth** — sequence + isFinal flag prevents reordering/truncation
- **Presigned URLs** — encrypted blobs go browser → R2 directly, never touch the server

## Getting Started

### Prerequisites

- Node.js 20+
- Supabase project
- Cloudflare R2 bucket

### Setup

```bash
git clone https://github.com/postysh/securewarp.git
cd securewarp
npm install
```

Create `.env.local`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SESSION_SECRET=minimum-32-character-random-string
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_BUCKET=securewarp
# At least 16 chars. Used as the Bearer token for /api/admin/cleanup-stale.
# On Vercel, set CRON_SECRET instead (or in addition) — Vercel forwards it
# automatically to scheduled cron invocations.
CLEANUP_SECRET=long-random-secret-for-cron-to-call-cleanup
```

Run database migrations (via Supabase dashboard or CLI):

```sql
-- Users
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  srp_salt text NOT NULL,
  srp_verifier text NOT NULL,
  argon2_salt text NOT NULL,
  encrypted_user_data text NOT NULL,
  public_encryption_key text NOT NULL,
  public_signing_key text NOT NULL,
  recovery_key_hash text,
  recovery_encrypted_data text,
  created_at timestamptz DEFAULT now()
);

-- SRP handshake sessions (ephemeral)
CREATE TABLE srp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) NOT NULL,
  server_secret_ephemeral text NOT NULL,
  client_public_ephemeral text NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);

-- Files and folders
CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES users(id) NOT NULL,
  parent_id uuid REFERENCES files(id),
  encrypted_metadata text NOT NULL,
  is_folder boolean DEFAULT false,
  size_bytes bigint DEFAULT 0,
  storage_key text,
  encryption_nonce text,
  chunk_count integer DEFAULT 1,
  upload_complete boolean NOT NULL DEFAULT true,
  -- Phase 2: per-file hierarchical keypair (Skiff model). The session key
  -- is wrapped once to the file's public hier key by the owner at upload.
  public_hierarchical_key text NOT NULL,
  encrypted_session_key_by_file text NOT NULL,
  session_key_nonce text NOT NULL,
  -- Phase 3: folder inheritance. Non-null when parent_id is set.
  -- `parent_keys_claim` = box({sessionKey, childPrivHier}, parent.pub_hier,
  -- owner.priv). Anyone with the parent's private hier key transitively
  -- unwraps every descendant without per-child ACL rows.
  parent_keys_claim text,
  parent_keys_claim_wrapped_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Per-user wrapped private hierarchical keys. Adding a collaborator wraps
-- the file's *private* hier key to that user's public encryption key —
-- constant-size regardless of the file size.
CREATE TABLE file_keys (
  file_id uuid REFERENCES files(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  encrypted_private_hierarchical_key text NOT NULL,
  -- Public key of whoever performed the wrap (owner for the initial row,
  -- any collaborator for re-shares). The recipient uses this as the
  -- nacl.box sender when unwrapping.
  wrapped_by_public_key text NOT NULL,
  permission_level text NOT NULL DEFAULT 'editor'
    CHECK (permission_level IN ('owner', 'editor', 'viewer')),
  PRIMARY KEY (file_id, user_id)
);

-- File chunks for large files
CREATE TABLE file_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid REFERENCES files(id) ON DELETE CASCADE NOT NULL,
  sequence integer NOT NULL,
  is_final boolean DEFAULT false,
  size_bytes bigint NOT NULL,
  storage_key text NOT NULL,
  encryption_nonce text NOT NULL,
  UNIQUE (file_id, sequence)
);

-- Distributed rate limiter (auth brute-force protection)
CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  reset_at timestamptz NOT NULL
);
CREATE INDEX rate_limits_reset_at_idx ON rate_limits (reset_at);

-- Atomic increment-or-reset. Returns true if the request is within the
-- limit, false if it should be throttled. Runs in a single statement so
-- concurrent calls cannot race past the cap.
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key text,
  p_max integer,
  p_window_ms integer
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_now   timestamptz := now();
  v_reset timestamptz := v_now + (p_window_ms || ' milliseconds')::interval;
  v_count integer;
BEGIN
  INSERT INTO rate_limits (key, count, reset_at)
  VALUES (p_key, 1, v_reset)
  ON CONFLICT (key) DO UPDATE
    SET count    = CASE WHEN rate_limits.reset_at < v_now THEN 1
                        ELSE rate_limits.count + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at < v_now THEN EXCLUDED.reset_at
                        ELSE rate_limits.reset_at END
  RETURNING count INTO v_count;

  RETURN v_count <= p_max;
END;
$$;

-- Single-use recovery token tracking (replaces in-memory Set)
CREATE TABLE used_recovery_tokens (
  jti text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX used_recovery_tokens_expires_at_idx ON used_recovery_tokens (expires_at);
```

You should run a periodic job (e.g. `pg_cron`) to prune expired rows from
`rate_limits` and `used_recovery_tokens`:

```sql
DELETE FROM rate_limits WHERE reset_at < now();
DELETE FROM used_recovery_tokens WHERE expires_at < now();
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Sharing (Phase 3 — hierarchical keys + folder inheritance)

SecureWarp uses Skiff's two-layer key design for file sharing.

**The two-layer model**:

1. **Symmetric session key** — per-file random key (xsalsa20-poly1305).
   Encrypts the file's content and its metadata. Never transmitted in the
   clear, never stored server-side in the clear.

2. **Asymmetric hierarchical keypair** — per-file Curve25519 keypair
   generated client-side at upload time.
   - `publicHierarchicalKey` is stored on the file row in plaintext.
   - The session key is wrapped **once** to that public key, with the
     owner as the `nacl.box` sender. Stored as
     `encrypted_session_key_by_file` + `session_key_nonce` on the file.
   - The *private* hierarchical key is wrapped per-user into
     `file_keys.encrypted_private_hierarchical_key`. Each row carries a
     `wrapped_by_public_key` — the sharer's public key at grant time,
     which the recipient needs as the box sender when unwrapping.

**Read path** (for any user who has a `file_keys` row):

```
private_hier = nacl.box.open(
  file_keys.encrypted_private_hierarchical_key,
  file_keys.wrapped_by_public_key,   // sender = whoever shared
  me.private_key,
)
session_key = nacl.box.open(
  files.encrypted_session_key_by_file,
  files.session_key_nonce,
  files.owner.public_encryption_key, // sender = owner at upload time
  private_hier,
)
```

**Why this is better than a direct per-user session-key wrap**:

- **O(1) shares.** Adding a collaborator is a single hier-key rewrap,
  regardless of file size. The session key never gets touched.
- **Non-owner re-sharing.** Any collaborator holds the file's private
  hierarchical key and can wrap it for someone new. Server-side check is
  "does the caller have a file_keys row", not "is the caller the owner".
- **Sets up Phase 3.** Child documents can encrypt their own session key
  and private hier key under the *parent's* public hier key
  (`parent_keys_claim`), giving folder inheritance without per-child ACL
  rows.
- **Sets up Phase 5.** Forward-secret revocation can rotate the
  hierarchical keypair + session key without touching content blobs.

**Endpoints**:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/users/public-key?email=` | Public-profile lookup for share grant |
| `POST` | `/api/files/share` | **Any collaborator** grants another user access |
| `POST` | `/api/files/unshare` | Owner removes a collaborator (or self-removal) |
| `POST` | `/api/files/leave` | Collaborator removes themselves |
| `POST` | `/api/files/permission` | Owner changes a collaborator's level |
| `GET` | `/api/files/collaborators?fileId=` | List everyone with access |
| `GET` | `/api/files/list?shared=true` | Flat view of files shared *with* the current user |

**Folder inheritance (Phase 3)**:

Sharing a folder is a single operation that transitively shares every
descendant. The machinery:

- At upload time, if a file has a parent, its session key and private
  hierarchical key are wrapped together into `parent_keys_claim =
  nacl.box({sessionKey, childPrivHier}, parent.public_hierarchical_key,
  owner.private_key)`. Stored on the child row.
- When a user is granted access to a folder F, they receive a
  `file_keys` row on F only — no new rows get created for F's children.
- The collaborator unwraps F's private hier key from their row, then
  walks down each descendant's `parent_keys_claim` to recover the
  child's session key and private hier key. Two-level deep works
  recursively: F → sub → leaf just chains the claim unwraps.
- The owner always has a direct `file_keys` row on every file they own
  (hybrid invariant), so their decrypt path is unchanged. Only
  collaborators-via-inheritance hit the claim walk.
- Moving items between folders and revoking inherited access by
  rotating claims is deferred to later phases.

**Still deferred**:

- **No forward-secret revocation.** `unshare`/`leave` delete the ACL row
  but do not rotate the file's hierarchical keypair, session key, or
  any `parent_keys_claim`. A revoked user who cached the private hier
  key retains decrypt capability on that cache. Rotation comes in
  Phase 5.
- **Viewer vs Editor is server-side ACL.** The cryptographic payload is
  identical for all non-owner collaborators; Viewer is enforced by the
  server refusing writes, not by withholding key material. A malicious
  server could bypass it. (Skiff has the same caveat.)
- **Collaborator avatars on inherited children under-report.** The
  file-list response only counts direct `file_keys` rows. An inherited
  child that gained visibility via a parent share will show only its
  owner in the stack. Effective ACL (direct ∪ ancestors) is a UI
  follow-up.
- **No link sharing** — Phase 4.

### Testing

```bash
npm test           # run once
npm run test:watch # watch mode
```

Tests live next to the modules they cover (`src/**/*.test.ts`). Vitest runs in
the Node environment, so the client-side crypto modules are exercised with the
same primitives (`tweetnacl`, `@noble/hashes`, `crypto.subtle`) that run in the
browser. Add tests whenever you touch anything in `src/lib/crypto/**` or the
SRP / session helpers — they are the highest-risk code in the project.

### Background maintenance

The API exposes `POST /api/admin/cleanup-stale`, gated by
`Authorization: Bearer $CLEANUP_SECRET`. It:

1. Deletes rows in `files` where `upload_complete = false` and
   `created_at < now() - 24h`, together with their R2 blobs and chunks.
2. Prunes expired rows from `rate_limits` and `used_recovery_tokens`.

The endpoint supports both `GET` and `POST` so it works with Vercel Cron
(which uses `GET` and forwards `Authorization: Bearer $CRON_SECRET`
automatically) as well as external tooling.

On **Vercel**, it's already wired: `vercel.json` declares a daily cron at
`0 3 * * *` (03:00 UTC) hitting `/api/admin/cleanup-stale`. Daily is the
Hobby plan cap — Pro unlocks sub-daily schedules if you need them. Set
the `CRON_SECRET` project env var (any ≥16-char string) and Vercel will
inject the Bearer token. You can leave `CLEANUP_SECRET` unset in that
environment, or set it to the same value for manual invocations.

Elsewhere (systemd timer, GitHub Actions, `cron`, etc.):

```
curl -X POST \
  -H "Authorization: Bearer $CLEANUP_SECRET" \
  https://your-app.example.com/api/admin/cleanup-stale
```

If you don't run the cron, orphan rows still stay hidden from users (filtered
by `upload_complete = true`), so this is a storage-hygiene concern, not a
correctness one.

### Deployment

Deploy to Vercel — encrypted file blobs go directly to R2 via presigned URLs, so Vercel serverless functions only handle small JSON metadata requests. No memory pressure.

## Storage Plans

| | Free | Pro |
|---|---|---|
| Storage | 20 GB | 100 GB |
| Max file size | 100 MB | 5 GB |
| Workspaces | 1 | Unlimited |
| Team members | 3 | Unlimited |
| Version history | — | 1 year |

## License

Private repository.
