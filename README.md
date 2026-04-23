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
  → XChaCha20-Poly1305 (encrypt content in 8 MB chunks)
  → Authenticated chunks (sequence + isFinal prevents tampering)
  → Session key wrapped to recipient's X25519 pub key via ECDH + HKDF + XChaCha20-Poly1305
  → Encrypted blob uploaded directly to R2 (server never touches plaintext)
```

### Cryptographic Primitives

| Primitive | Usage |
|-----------|-------|
| **X25519** | Asymmetric encryption keypairs (ECDH for key wrap) |
| **XChaCha20-Poly1305** | Symmetric file + metadata encryption (AEAD) |
| **Argon2id** | Password-based key derivation |
| **HKDF-SHA256** | Key splitting (auth key + encryption key + ECDH-to-AEAD KDF) |
| **SRP-6a** | Zero-knowledge password authentication |
| **BIP39** | 24-word mnemonic recovery keys |

Crypto v2 (2026-04-20) rotated off tweetnacl's `nacl.box` / `nacl.secretbox` (which used Curve25519 + xsalsa20-poly1305) to `@noble/ciphers` + `@noble/curves`. The asymmetric wrap is now explicit: X25519 ECDH produces a shared secret, HKDF-SHA256 derives a 32-byte key, XChaCha20-Poly1305 seals with a 24-byte nonce. Where older comments in this file still reference `nacl.box` / `xsalsa20-poly1305`, read them as this chain / XChaCha20-Poly1305 respectively; a full prose pass is tracked as a follow-up.

### Zero-Knowledge Auth (SRP-6a)

Your password never leaves your browser — not even as a hash. The SRP protocol proves you know the password without revealing it. The server stores a verifier that cannot be reversed into the password.

### Recovery Keys

Recovery keys use HKDF to derive separate verification and encryption keys from the BIP39 mnemonic. The server stores a hash of the verification key (not the encryption key), so even a database breach cannot decrypt recovery-encrypted data.

### Session resume (lock cache)

Decrypted private keys live in `sessionStorage` and die when the tab closes, but the auth cookie is a 7-day JWT. To avoid forcing a full SRP handshake on every tab reopen, SecureWarp persists an **encrypted** snapshot of the four key strings in `localStorage`, wrapped under a third HKDF output of the master key (`unlockCacheKey`, info string `securewarp-unlock-cache-v1`). On tab reopen the user enters only their password; the browser re-runs Argon2id + HKDF locally and unseals the blob — no server round-trip.

The threat model is deliberately the same as the SRP verifier's: a disk-level attacker gets a ciphertext and a salt, both useless without the password. An XSS attacker reading `localStorage` gets the same ciphertext, also useless without the password. The cache is cleared on explicit logout, password change, and recovery so the old blob never outlives the password that can unwrap it.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16 (App Router) |
| **Frontend** | React 19, Tailwind CSS 4, TypeScript |
| **Icons** | Hugeicons |
| **Client Crypto** | @noble/ciphers (XChaCha20-Poly1305), @noble/curves (X25519), @noble/hashes (HKDF + SHA-256), hash-wasm (Argon2id WASM), bip39 |
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
# Cloudflare Turnstile (optional). When TURNSTILE_SECRET_KEY is unset the
# server-side verifier treats every request as passing — handy for local
# dev. Once you provision a Turnstile site in the Cloudflare dashboard,
# set both variables and auth routes start enforcing the widget.
TURNSTILE_SECRET_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
# Resend (optional). When RESEND_API_KEY is unset, src/lib/email/send.ts
# runs in dev no-op mode: it logs a one-line summary and returns success
# without hitting the network. Handy for local dev and CI. In production,
# verify your sending domain in the Resend dashboard, add the SPF/DKIM
# records to your DNS zone, and set both vars below.
RESEND_API_KEY=
EMAIL_FROM="SecureWarp <no-reply@yourdomain.com>"
# Optional — set this if you want replies to land somewhere other than
# the From address.
EMAIL_REPLY_TO=
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

-- Phase 4: public link sharing
CREATE TABLE file_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- secretbox(file.private_hierarchical_key, link_key_nonce, linkKey)
  encrypted_private_hierarchical_key text NOT NULL,
  link_key_nonce text NOT NULL,
  permission_level text NOT NULL DEFAULT 'viewer'
    CHECK (permission_level IN ('viewer')),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX file_links_file_id_active_idx
  ON file_links (file_id) WHERE revoked_at IS NULL;
CREATE INDEX file_links_created_by_idx ON file_links (created_by);

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

-- Append-only security audit log (auth, share, rotate, link events).
-- Deliberately lightweight — no request bodies, no ciphertexts, just
-- classification codes for post-incident forensics.
CREATE TABLE security_audit (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  target_link_id uuid REFERENCES file_links(id) ON DELETE SET NULL,
  source_hint text,
  detail text
);
CREATE INDEX security_audit_event_time_idx ON security_audit (event_type, occurred_at DESC);
CREATE INDEX security_audit_actor_idx ON security_audit (actor_user_id, occurred_at DESC);
CREATE INDEX security_audit_target_file_idx ON security_audit (target_file_id, occurred_at DESC);

-- Phase 6: trash (soft delete). `delete` endpoint now sets
-- `deleted_at = now()` via the recursive `soft_delete_subtree` helper;
-- `restore` reverses it; `purge` / `trash/empty` hard-delete trashed
-- rows and their R2 blobs.
ALTER TABLE files ADD COLUMN deleted_at timestamptz;
CREATE INDEX files_live_by_parent_idx
  ON files (owner_id, parent_id)
  WHERE deleted_at IS NULL;
CREATE INDEX files_trashed_by_owner_idx
  ON files (owner_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION soft_delete_subtree(p_root uuid, p_owner uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  WITH RECURSIVE subtree AS (
    SELECT id FROM files WHERE id = p_root AND owner_id = p_owner AND deleted_at IS NULL
    UNION ALL
    SELECT f.id FROM files f INNER JOIN subtree s ON f.parent_id = s.id
    WHERE f.owner_id = p_owner AND f.deleted_at IS NULL
  )
  UPDATE files SET deleted_at = now() WHERE id IN (SELECT id FROM subtree);
END $$;

CREATE OR REPLACE FUNCTION restore_subtree(p_root uuid, p_owner uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_root_deleted_at timestamptz;
BEGIN
  SELECT deleted_at INTO v_root_deleted_at FROM files WHERE id = p_root AND owner_id = p_owner;
  IF v_root_deleted_at IS NULL THEN RETURN; END IF;
  WITH RECURSIVE subtree AS (
    SELECT id FROM files WHERE id = p_root AND owner_id = p_owner
    UNION ALL
    SELECT f.id FROM files f INNER JOIN subtree s ON f.parent_id = s.id
    WHERE f.owner_id = p_owner AND f.deleted_at = v_root_deleted_at
  )
  UPDATE files SET deleted_at = NULL WHERE id IN (SELECT id FROM subtree);
END $$;

-- Output columns are `out_*` prefixed to avoid a PL/pgSQL ambiguity
-- between the RETURNS TABLE variables and the identically-named
-- source columns on `files` / `file_chunks`. If you rename the
-- outputs you MUST also update the /purge route's destructuring.
CREATE OR REPLACE FUNCTION subtree_storage_keys(p_root uuid, p_owner uuid)
RETURNS TABLE(out_file_id uuid, out_storage_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE subtree AS (
    SELECT f.id, f.storage_key FROM files f WHERE f.id = p_root AND f.owner_id = p_owner
    UNION ALL
    SELECT f.id, f.storage_key FROM files f INNER JOIN subtree s ON f.parent_id = s.id
    WHERE f.owner_id = p_owner
  )
  SELECT s.id, s.storage_key FROM subtree s WHERE s.storage_key IS NOT NULL
  UNION ALL
  SELECT fc.file_id, fc.storage_key FROM file_chunks fc INNER JOIN subtree s ON fc.file_id = s.id;
END $$;

-- Phase 7: admin panel. `role` gates access to /admin routes; `owner` can
-- do everything, `admin` can suspend/view, `user` is the default. Suspended
-- users are blocked at session check — their JWT is valid but the session
-- helper returns null, effectively logging them out everywhere. `last_login_at`
-- populates the admin users table and powers "active users" metrics.
ALTER TABLE users
  ADD COLUMN role text NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'admin', 'owner')),
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN suspended_reason text,
  ADD COLUMN last_login_at timestamptz;

CREATE INDEX users_role_idx ON users (role) WHERE role <> 'user';
CREATE INDEX users_suspended_idx ON users (suspended_at) WHERE suspended_at IS NOT NULL;

-- Seed yourself as owner (replace with your email, run once after migrating).
-- UPDATE users SET role = 'owner' WHERE email = 'you@example.com';

-- Admin audit log — separate from `security_audit` so admin actions can't
-- be fabricated alongside user actions, and so admin forensics survive even
-- if security_audit is ever pruned. Append-only; never delete rows here.
CREATE TABLE admin_audit (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  detail text
);
CREATE INDEX admin_audit_occurred_at_idx ON admin_audit (occurred_at DESC);
CREATE INDEX admin_audit_target_user_idx ON admin_audit (target_user_id, occurred_at DESC);

-- Per-user admin-only notes. Internal support/operator context,
-- never exposed to the user themselves. Body capped at 2k chars.
CREATE TABLE admin_notes (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_email text,
  body text NOT NULL CHECK (char_length(body) <= 2000)
);
CREATE INDEX admin_notes_user_idx ON admin_notes (user_id, created_at DESC);

-- Announcements banner. Admin-authored strips shown at the top of the
-- drive for all logged-in users. Drafts have `published_at IS NULL`;
-- `expires_at` optionally auto-hides. Per-user dismissals live in
-- announcement_dismissals so an `X` click persists across sessions.
CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by_email text,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical')),
  published_at timestamptz,
  expires_at timestamptz
);
CREATE INDEX announcements_active_idx
  ON announcements (published_at DESC)
  WHERE published_at IS NOT NULL;

CREATE TABLE announcement_dismissals (
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);
CREATE INDEX announcement_dismissals_user_idx
  ON announcement_dismissals (user_id);

-- Feature flags / app settings. Key/value so new flags don't need a
-- migration. Known keys live in src/lib/flags.ts with fallback
-- defaults; the admin UI at /admin/flags surfaces the DB rows.
CREATE TABLE app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_email text
);
INSERT INTO app_settings (key, value, description) VALUES
  ('signups_enabled', 'true',
   'When off, /api/auth/register returns 503. Useful to block signups during an abuse wave while keeping existing users logged in.'),
  ('uploads_enabled', 'true',
   'When off, /api/files/chunk-upload returns 503 so users can still log in and browse but can''t create new files. Use during R2 outages.');

-- Phase 8: onboarding. `onboarded_at` gates the /welcome wizard. NULL
-- means "show the wizard"; any timestamp means "skip it." Existing users
-- get NULL by default, which is correct — they haven't been offered the
-- display-name step yet and it's useful to prompt them once.
ALTER TABLE users ADD COLUMN onboarded_at timestamptz;

-- Admin user-delete cleanup. The admin hard-delete endpoint relies on
-- cascades from `users` to wipe owned files, their keys/chunks/links,
-- notifications, and live SRP challenges. `files.owner_id` and
-- `srp_sessions.user_id` were created without ON DELETE CASCADE, so
-- deleting any user who had ever owned a file (or started an unfinished
-- SRP handshake) failed with an FK violation. Retrofit CASCADE on both.
ALTER TABLE files
  DROP CONSTRAINT files_owner_id_fkey,
  ADD CONSTRAINT files_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE srp_sessions
  DROP CONSTRAINT srp_sessions_user_id_fkey,
  ADD CONSTRAINT srp_sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
```

#### Encrypted search index (Phase 1)

The encrypted search feature stores per-user opaque token hashes that
the server matches against query hashes the client computes with the
same HKDF-derived `searchIndexKey`. Plaintext tokens never reach the
server. See `src/lib/search/` and AGENTS.md → "Encrypted search".

```sql
CREATE TABLE file_search_tokens (
  user_id     uuid  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id     uuid  NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL,
  PRIMARY KEY (user_id, file_id, token_hash)
);
-- Primary lookup pattern: "all file_ids for this user matching ANY of
-- these N token hashes." A composite index on (user_id, token_hash)
-- supports that with no extra sort.
CREATE INDEX file_search_tokens_lookup_idx
  ON file_search_tokens (user_id, token_hash);

-- Backfill markers. NULL means "this user pre-dates the corresponding
-- pass and needs to reindex." Each is set to now() once the client
-- finishes a full pass over the user's accessible files.
--   search_indexed_at         → filename / folder name pass
--   search_content_indexed_at → text + Office body content pass
ALTER TABLE users ADD COLUMN search_indexed_at timestamptz;
ALTER TABLE users ADD COLUMN search_content_indexed_at timestamptz;

-- RLS belt-and-braces (the API uses the service-role client, but
-- enabling RLS prevents anonymous-key access if it ever leaks).
ALTER TABLE file_search_tokens ENABLE ROW LEVEL SECURITY;
```

#### TOTP two factor authentication

```sql
-- Nullable: null = 2FA not enabled; base32 secret = enabled.
-- Checked at login verify time; stored plaintext since the server
-- needs the secret to validate TOTP codes.
ALTER TABLE users ADD COLUMN totp_secret text;
```

#### Stripe billing (tier-based)

```sql
-- One row per SecureWarp user that has ever interacted with billing
-- (checkout, subscription, portal). stripe_customer_id holds Stripe's
-- cus_... id.
CREATE TABLE billing_customers (
  user_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id  text NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Active + historical subscriptions. Entitlement checks read the
-- most recent row per user and branch on status. `raw` keeps the
-- full Stripe Subscription payload for debugging without re-fetching.
CREATE TABLE billing_subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id text NOT NULL UNIQUE,
  status                 text NOT NULL, -- active | canceled | past_due | incomplete | trialing
  current_period_end     timestamptz,
  stripe_price_id        text NOT NULL,
  raw                    jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_subscriptions_user_idx ON billing_subscriptions (user_id, created_at DESC);

-- RLS belt-and-braces (API uses service role, but kills anon-key access).
ALTER TABLE billing_customers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_subscriptions  ENABLE ROW LEVEL SECURITY;
```

**Migration from previous Polar-era column names** (run once against existing DBs before deploying the Stripe-only code):

```sql
ALTER TABLE billing_customers
  RENAME COLUMN polar_customer_id TO stripe_customer_id;

ALTER TABLE billing_subscriptions
  RENAME COLUMN polar_subscription_id TO stripe_subscription_id;

ALTER TABLE billing_subscriptions
  RENAME COLUMN product_id TO stripe_price_id;

-- billing_usage_events is no longer written by any code path. Drop it
-- if it exists on your DB (safe: no code reads it):
DROP TABLE IF EXISTS billing_usage_events;
```

#### Workspace security policy

```sql
-- Per-workspace admin toggles surfaced in Workspace Settings →
-- Security. Enforcement lives in the API layer:
--   * require_2fa              — /api/workspaces/list marks
--                                 the workspace "locked" for any
--                                 member without totp_secret; the
--                                 switcher dims it + a follow-up
--                                 will extend the check into
--                                 /api/files/* routes.
--   * links_disabled           — /api/files/link/create rejects
--                                 when the file's workspace has
--                                 this flag true.
--   * links_require_password   — same endpoint, rejects if no
--                                 passwordSalt/wrap passed.
--   * links_max_expiry_days    — same endpoint, rejects if the
--                                 requested expiresAt is null
--                                 (no expiry) or too far in the
--                                 future.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS require_2fa boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS links_disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS links_require_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS links_max_expiry_days integer;

-- 1..365 day cap so a typo ("3650") doesn't mint effectively-
-- permanent links inside a workspace that claims to cap expiry.
ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_links_max_expiry_days_range
    CHECK (links_max_expiry_days IS NULL OR (links_max_expiry_days > 0 AND links_max_expiry_days <= 365));
```

#### Active sessions UI metadata

```sql
-- Metadata columns on the JWT sessions table so the Settings →
-- Security → Active sessions UI can distinguish one device from
-- another without re-querying the identity on every request.
--   * last_seen_at — bumped at most once per minute from getSession;
--                    "Last active N ago" in the UI
--   * user_agent   — raw UA string from the login request. Parsed
--                    client-side into "Chrome on macOS"-style labels.
--                    Already visible to Cloudflare + Supabase logs;
--                    storing it here is net-zero new PII exposure.
--   * country      — ISO-3166-1 alpha-2 from the Cloudflare
--                    CF-IPCountry header at mint time. NOT updated on
--                    subsequent requests so we capture "where signed
--                    in from", not "where they are now".
-- created_at already existed on the table from the initial session
-- schema, so it's not re-added here.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS country text;

CREATE INDEX IF NOT EXISTS sessions_user_id_last_seen_idx
  ON sessions (user_id, last_seen_at DESC);
```

You should run a periodic job (e.g. `pg_cron`) to prune expired rows from
`rate_limits` and `used_recovery_tokens`:

```sql
DELETE FROM rate_limits WHERE reset_at < now();
DELETE FROM used_recovery_tokens WHERE expires_at < now();
```

#### NEW-badge tracker (per-user seen state)

```sql
-- Replaces the localStorage-only seen map in use-new-files.ts so the
-- NEW pill stays dismissed across browsers and devices. Not security
-- sensitive: the server already knows which files a user can access;
-- this only records when they first acknowledged each one.
CREATE TABLE IF NOT EXISTS user_file_seen (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, file_id)
);

ALTER TABLE user_file_seen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read their own seen rows"
  ON user_file_seen FOR SELECT
  USING (auth.uid() = user_id);
```

#### Multi-bucket chunk sharding

```sql
-- Chunks are distributed across N=5 R2 buckets (securewarp-shard-0..4)
-- so the browser opens N independent TCP connections instead of
-- multiplexing 5 streams over one. Each file_chunks row records which
-- shard holds its ciphertext — read paths (download, rotate, delete)
-- use this to route requests to the correct bucket.
--
-- Zero-knowledge is unchanged: only the storage location moved, not
-- the cipher or the keys. DEFAULT 0 is a safe fallback if a row
-- somehow slips in without the column set; new uploads always write
-- the real shard.
ALTER TABLE file_chunks
  ADD COLUMN IF NOT EXISTS shard smallint NOT NULL DEFAULT 0;

-- Rewrite subtree_storage_keys to include the shard column and drop
-- the legacy `files.storage_key` branch (the single-blob upload path
-- is gone — every file now lives in file_chunks exclusively).
-- Callers (/api/files/purge) destructure the new `out_shard` field
-- and pass (shard, storageKey) tuples to the bulk-delete helper.
--
-- DROP first because the return-type shape changed; Postgres won't
-- let CREATE OR REPLACE redefine RETURNS TABLE columns.
DROP FUNCTION IF EXISTS subtree_storage_keys(uuid, uuid);

CREATE FUNCTION subtree_storage_keys(p_root uuid, p_owner uuid)
RETURNS TABLE(out_file_id uuid, out_storage_key text, out_shard smallint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE subtree AS (
    SELECT f.id FROM files f WHERE f.id = p_root AND f.owner_id = p_owner
    UNION ALL
    SELECT f.id FROM files f INNER JOIN subtree s ON f.parent_id = s.id
    WHERE f.owner_id = p_owner
  )
  SELECT fc.file_id, fc.storage_key, fc.shard
  FROM file_chunks fc
  INNER JOIN subtree s ON fc.file_id = s.id;
END $$;
```

#### User R2 region (foundation for future multi-region)

```sql
-- Tag every user with a geographic R2 region at signup, derived from
-- the CF-IPCountry header (see src/lib/billing/region.ts). NOT used
-- for routing yet — all R2 traffic still lands in the ENAM shards.
-- Landed first so when we eventually provision per-region bucket
-- sets (wnam, weur, apac) existing users are already correctly
-- tagged and no backfill migration is needed.
--
-- CHECK constraint locks the allowed values to the four CF regions
-- we plan to support. New regions → update the constraint + the
-- detectRegionFromCountry mapping together.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS r2_region text NOT NULL DEFAULT 'enam'
    CHECK (r2_region IN ('enam', 'wnam', 'weur', 'apac'));

CREATE INDEX IF NOT EXISTS users_r2_region_idx ON users (r2_region);
```

#### Abuse reports

```sql
-- Abuse reports surface — users or anonymous share-link visitors can
-- flag a file. We can't look at content (zero-knowledge), so the
-- report carries a human-written claim + category + whatever access
-- proof the reporter had. Admin reviews via metadata + claim and can
-- terminate the owner's account if warranted.
--
-- file_id / link_id are nullable so a report outlives the underlying
-- row (deleted files / revoked links shouldn't wipe the audit trail).
-- file_owner_id is snapshotted at report time so we can still act on
-- the original owner even after the file row is gone.
CREATE TABLE IF NOT EXISTS file_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  link_id uuid REFERENCES file_links(id) ON DELETE SET NULL,
  file_owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  reporter_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reporter_email text,
  reporter_ip_hash text,
  category text NOT NULL CHECK (category IN (
    'csam', 'harassment', 'malware', 'copyright', 'illegal', 'other'
  )),
  details text NOT NULL CHECK (length(details) <= 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'dismissed', 'actioned', 'escalated'
  )),
  handled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  handler_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS file_reports_pending_idx
  ON file_reports (created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS file_reports_owner_idx
  ON file_reports (file_owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS file_reports_dedup_idx
  ON file_reports (reporter_ip_hash, file_id, created_at DESC)
  WHERE reporter_ip_hash IS NOT NULL;

ALTER TABLE file_reports ENABLE ROW LEVEL SECURITY;
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
- **Link sharing shipped in Phase 4** — see below.

### Public link sharing (Phase 4)

Any collaborator on a file or folder can generate a public link. The link
works for anyone with the URL — no SecureWarp account required — and
remains end-to-end encrypted: the server never sees a key capable of
decrypting the file.

**How it works**:

1. The client generates a fresh 32-byte symmetric `linkKey` via
   `nacl.randomBytes`.
2. It unwraps the file's private hierarchical key from its own
   `file_keys` row (the same key it uses for direct access), then wraps
   it under `linkKey` with `nacl.secretbox`. The resulting
   `encrypted_private_hierarchical_key` + `link_key_nonce` is the only
   ciphertext the server persists in `file_links`.
3. The URL is built client-side: `${origin}/share/${linkId}#${linkKey}`.
   `linkKey` lives in the URL fragment, which browsers never send to
   servers in HTTP requests.
4. An anonymous visitor opens the link. The `/share/[id]` page reads the
   fragment, fetches the link row from `/api/files/link/[id]`, uses
   `linkKey` to unwrap the private hierarchical key, then uses that to
   unwrap the session key wrapped to the file's public hier key by the
   owner (same two-step flow a registered collaborator uses). Metadata
   and content decrypt entirely client-side.
5. For folder links, the visitor walks the `parent_keys_claim` chain on
   descendants using the folder's private hierarchical key — identical
   to the Phase 3 inherited-access flow, just with no `file_keys` row
   on the anonymous side.

**Endpoints**:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/files/link/create` | user | Any collaborator mints a link |
| `GET`  | `/api/files/link?fileId=` | user | List active links for a file |
| `POST` | `/api/files/link/[id]/revoke` | user | Creator or file owner revokes |
| `GET`  | `/api/files/link/[id]` | **anon** | Anonymous metadata + wrapped priv hier |
| `GET`  | `/api/files/link/[id]/children?parentId=` | **anon** | Folder-link children listing |
| `GET`  | `/api/files/link/[id]/download?fileId=` | **anon** | Chunk URLs for a file inside the link's scope |

Every anonymous route calls `assertLinkCovers(link, targetFileId)` before
returning data: a link to folder A cannot be used as a bearer token to
read a sibling folder B. Descendant verification walks upward from the
target through `parent_id` with a 64-level depth cap.

**Password-protected links (Phase 4.1)**:

Any link can optionally require a password. When a password is set:

1. The client generates a fresh 16-byte salt.
2. `argon2id(password, salt, {t: 2, m: 32 MB, p: 1, dkLen: 32})` → a
   32-byte wrapping key. Uses `@noble/hashes/argon2` so the exact
   same code paths run in the browser and in Node tests.
3. The linkKey is symmetrically wrapped under the derived key via
   `nacl.secretbox`. The ciphertext + salt + nonce live in three new
   `file_links` columns, locked together by a CHECK constraint.
4. **The URL has no fragment.** A password-protected link is
   `/share/${id}` with no `#linkKey`. The password is the sole key
   material the visitor needs to provide, and it's never transmitted
   to the server.
5. On the visitor side, `/share/[id]` detects `hasPassword: true` in
   the link payload and shows a password prompt. On submit, it runs
   the same Argon2id derivation locally, unwraps the linkKey, and
   proceeds with the normal two-step unwrap flow.

Password links are strictly stronger than URL-fragment links: the URL
alone is not sufficient. Brute-forcing the password requires Argon2id
per attempt, which bounds the attacker's throughput to whatever
hardware they're willing to burn.

**What's still deferred to Phase 4.2+ / Phase 4.3**:

- **Editor-level links.** SecureWarp has no anonymous write surface
  yet — the `file_links.permission_level` CHECK constraint still only
  admits `"viewer"`. Editor-level links will land when there's an
  anonymous chunked-upload endpoint to gate them on (Phase 4.3).
- **Link retrieval.** The URL is shown exactly once at creation and
  cannot be recovered server-side. This is intentional: Skiff does the
  same, and it prevents link leakage via the share modal of a
  compromised account.

**Anonymous rate limits**: `/api/files/link/[id]`, `/children`, and
`/download` are all rate-limited per forwarded IP (via
`x-vercel-forwarded-for` on Vercel, `x-forwarded-for` elsewhere). The
key format is `link:get:${ip}` / `link:children:${ip}` /
`link:download:${ip}`. On shared-IP networks the limit is lax (300/hr)
to avoid cross-user interference; the 128-bit random link IDs make
enumeration infeasible regardless.

### Forward-secret revocation (Phase 5)

The default `/api/files/unshare` is an ACL delete. It's cheap but it
doesn't invalidate anything a revoked user may have cached — old
ciphertext, old session keys, and old private hierarchical keys all
remain usable against their cached copies.

Phase 5 ships an **opt-in** "Revoke" button in the share modal that
triggers a full client-side key rotation:

1. Owner downloads and decrypts every chunk of the file to reassemble
   the plaintext.
2. Generates a new random session key + a new hierarchical keypair.
3. Re-encrypts the plaintext under the new session key, chunk-by-chunk.
4. Wraps the new session key to the new public hierarchical key.
5. Re-wraps the new private hier key for each remaining collaborator
   (including the owner) and updates the `parent_keys_claim` on the
   row if the file has a parent.
6. POSTs `/api/files/[id]/rotate-init` → gets a fresh set of
   presigned R2 URLs under a new prefix (`v<timestamp>/`).
7. Uploads the newly-encrypted chunks.
8. POSTs `/api/files/[id]/rotate-commit` with every new ciphertext +
   the remaining collaborator wraps + the revoked user id.
9. Server atomically swaps: updates the files row, replaces
   `file_chunks`, deletes the revoked user's `file_keys` row, upserts
   the remaining rows, and fires a background cleanup of the old R2
   blobs.

**Invariants enforced on commit**:

- Caller is the file owner.
- File is not a folder (flagged for a future pass).
- `remainingCollaborators ∪ {revokedUserId}` must exactly equal the
  current `file_keys` set. If a collaborator was added or removed
  between init and commit, the server returns 409 and the client can
  retry with a fresh list.
- The owner must stay in the collaborator set — you cannot revoke
  yourself through this endpoint.

**Folder shallow rotation (Phase 5.1)** — the "Revoke" button on a
folder triggers a different flow than on a file: instead of re-encrypting
content, it **rotates the folder's hierarchical keypair and re-wraps the
`parent_keys_claim` of every direct child under the new folder pub hier
key**. Grandchildren and deeper are untouched — their claims live under
their own (unchanged) parent's pub hier, so the chain still works for
remaining collaborators.

Flow:
1. Client fetches `/api/files/[id]/folder-rotate-context` — folder row,
   direct children with their current claims, current collaborator set.
2. Client unwraps the caller's current file_keys row on the folder to
   get the old folder priv hier.
3. Client walks every direct child, unwrapping its
   `parent_keys_claim` to recover `{childSessionKey, childPrivHier}`
   — these are NOT rotated, only the envelope around them is.
4. Client generates a new folder hierarchical keypair and session key.
5. Client re-wraps each direct child's `parent_keys_claim` under the
   new folder pub hier, re-wraps the new folder priv hier for each
   remaining collaborator, and optionally re-wraps the folder's own
   parent_keys_claim if it has a parent.
6. Client POSTs `/api/files/[id]/rotate-folder-commit` with everything.
7. Server atomically updates: folder row → new file_keys rows →
   direct children's claim columns → delete revoked row. Retries once
   on 409 if the direct-child or collaborator set drifted during the
   walk.

**Honest threat model** — shallow rotation is strictly better than
ACL-only unshare, but it is **not** full forward secrecy on
pre-existing descendants:

- **New files added after rotation**: fully protected. They get
  wrapped under the new folder pub hier, and the revoked user never
  had access to it.
- **Files the revoked user never opened**: fully protected. They
  need the new folder priv hier to walk the chain, and they don't
  have it.
- **Files the revoked user already opened and cached**: the revoked
  user retains access to *that specific snapshot of that specific
  file*, because their local cache already holds the descendant's
  session key and priv hier (neither of which we rotate). If the
  content is later modified, they lose access to the new version.
- **Full recursive re-encryption** (download, re-encrypt, re-upload
  every descendant's chunks) would give true forward secrecy on all
  descendants but is untenable for folders with thousands of files.
  Skiff's published code doesn't do it either — shallow rotation
  is the industry-standard tradeoff.

**What's still deferred**:

- **Orphan R2 cleanup on partial failure.** If the DB sequence fails
  mid-way after uploading new chunks, the new R2 blobs become orphans.
  The daily cleanup cron doesn't currently target them — a manual
  cleanup or a future sweep job covers the gap.
- **Link-key rotation on `unshare`.** Revoking a link (Phase 4) still
  just marks `revoked_at`; it doesn't rotate the linkKey or re-wrap
  the file. The same rotate flow could be extended to links later.

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
