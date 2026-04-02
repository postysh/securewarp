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
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Per-user encrypted session keys
CREATE TABLE file_keys (
  file_id uuid REFERENCES files(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  encrypted_session_key text NOT NULL,
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
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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
