# E2E Encrypted Drive SaaS — Research & Architecture Reference

> Based on analysis of Skiff's open-source repositories, whitepaper (February 2023), design system, and product marketing pages. All code will be a clean-room implementation — no Skiff code is used (their main repo is CC-BY-NC-SA 4.0, non-commercial only). Encryption concepts are publicly documented and freely implementable.

---

## Table of Contents

1. [Skiff Background & Open Source Audit](#1-skiff-background--open-source-audit)
2. [Encryption Architecture — Key Model](#2-encryption-architecture--key-model)
3. [File Encryption Model](#3-file-encryption-model)
4. [Filesystem & Hierarchical Keys](#4-filesystem--hierarchical-keys)
5. [Sharing Model](#5-sharing-model)
6. [SRP Authentication Protocol](#6-srp-authentication-protocol)
7. [Password Change Flow](#7-password-change-flow)
8. [Account Recovery](#8-account-recovery)
9. [UI & Design References](#9-ui--design-references)
10. [Proposed Tech Stack](#10-proposed-tech-stack)
11. [Database Schema](#11-database-schema)
12. [Implementation Phases](#12-implementation-phases)
13. [Competitive Landscape](#13-competitive-landscape)
14. [Key Risks & Tradeoffs](#14-key-risks--tradeoffs)
15. [Resource Links](#15-resource-links)

---

## 1. Skiff Background & Open Source Audit

### What Was Skiff?

Skiff was a privacy-first, end-to-end encrypted workspace (Mail, Calendar, Pages, Drive) founded in 2020 by Andrew Milich and Jason Ginsberg. It raised $14.2M from Sequoia Capital and others, reaching nearly 2 million users by November 2023. Notion acquired Skiff in February 2024, and all services were shut down by August 9, 2024. Email forwarding continued until February 9, 2025.

### Repository Audit (github.com/skiff-org)

| Repo | Stars | Language | License | Usable? |
|------|-------|----------|---------|---------|
| **skiff-apps** | 952 | TypeScript | CC-BY-NC-SA 4.0 | ❌ Non-commercial only. Study concepts, don't copy code. |
| **skiff-ui** | 418 | TypeScript | MIT | ✅ Freely usable. React component library / design system. |
| **cipher** | 12 | C | MIT | ✅ Crypto primitives, niche use. |
| **skiff-windows-app** | 123 | C# | AGPL-3.0 | ⚠️ Copyleft — must release source if used. |
| **typed-envelopes** | 32 | TypeScript | AGPL-3.0 | ⚠️ Typed AEAD envelopes. AGPL copyleft. |
| **prosemirror-tables** | 29 | JavaScript | MIT | ✅ Only relevant for rich text editors. |
| **time-picker** | 7 | TypeScript | — | Minimal utility. |
| **react-express-typescript** | 5 | HTML | — | Boilerplate starter. |

### Key Takeaway

The whitepaper is the most valuable asset — it documents the entire encryption model publicly. The `skiff-ui` library (MIT) is useful for studying component patterns. All encryption concepts use standard, well-documented cryptographic primitives that can be implemented independently.

---

## 2. Encryption Architecture — Key Model

### Account Creation Flow

```
Password
  → Argon2id (memory-hard KDF, ~0.5-1s)
    → HKDF (split into two keys)
      → srp_key (used ONLY for SRP authentication handshake)
      → password_derived_secret (used ONLY to encrypt private keys)
```

### Per-User Keys (Generated at Signup)

| Key | Algorithm | Storage | Purpose |
|-----|-----------|---------|---------|
| Encryption public key | Curve25519 | Server (plaintext) | Shared freely. Others use it to encrypt file keys for you. |
| Encryption private key | Curve25519 | Server (encrypted inside `encrypted_user_data`) | Decrypts file session keys. Never leaves browser unencrypted. |
| Signing public key | Ed25519 | Server (plaintext) | Others use it to verify your signatures. |
| Signing private key | Ed25519 | Server (encrypted inside `encrypted_user_data`) | Signs shared content to prove authenticity. |

### What Never Leaves the Browser

- Password (plain text)
- `password_derived_secret`
- Decrypted private keys

### What the Server Stores

- `encrypted_user_data` — private keys encrypted with `password_derived_secret`
- SRP `salt` and `verifier` — cannot reverse-engineer the password
- Public keys — freely shareable

### Encryption Libraries Used by Skiff

- **tweetnacl-js** — Curve25519 keypairs, `tweetnacl.box` (asymmetric authenticated encryption), `tweetnacl.secretbox` (xsalsa20-poly1305 symmetric AEAD)
- **Argon2id** — password-based key derivation (memory-hard, resists GPU/ASIC attacks)
- **HKDF** — derives multiple purpose-specific keys from a single master key

---

## 3. File Encryption Model

### Per-File Keys

Every file (or document/page) has two cryptographic keys:

| Key | Type | Purpose |
|-----|------|---------|
| `session_key` | Symmetric (xsalsa20-poly1305) | Encrypts all file content and metadata (name, icon, timestamps). All collaborators share the same key. |
| `hierarchical_keypair` | Asymmetric (Curve25519) | Enables O(1) recursive folder sharing. Parent folder's public key encrypts child's private key. |

### File Upload Flow

```
1. User selects file in browser
2. Client generates random session_key
3. Client encrypts file content + metadata with session_key (secretbox)
4. Client encrypts session_key with user's public encryption key (box)
5. Upload encrypted blob to storage
6. Store encrypted session_key copy alongside file metadata
```

### File Open Flow

```
1. Download user's encrypted copy of session_key
2. Decrypt session_key with user's private encryption key
3. Download encrypted file content
4. Decrypt file content with session_key
5. Render in browser
```

### Chunk Model (Large Files)

Files are split into authenticated chunks, each encrypted with the `session_key`. Each chunk authenticates:
- Its zero-indexed sequence number
- A boolean flag indicating if it's the final chunk

This prevents reordering or omission by a compromised server. Enables efficient streaming of large files without decrypting the entire file first.

---

## 4. Filesystem & Hierarchical Keys

### The Problem

Naive sharing requires encrypting the session key for each user on each file — O(n) per file, O(n×m) for a folder with m files. Unscalable for organizations with thousands of files.

### The Solution: Hierarchical Keypairs

Each file/folder maintains:
1. A symmetric `session_key` (encrypts content/metadata)
2. An asymmetric `hierarchical_keypair` (Curve25519)

**Parent-child relationship:**
- Child's `private_hierarchical_key` + `session_key` are encrypted with parent's `public_hierarchical_key`
- Stored in a `parentKeysClaim` field on the child

**Recursive decryption:**
```
User decrypts root folder's hierarchical private key
  → Decrypts child folder's hierarchical private key + session key
    → Decrypts grandchild's hierarchical private key + session key
      → ... continues recursively
```

### Sharing Complexity

| Operation | Complexity | How |
|-----------|------------|-----|
| Share a folder tree | **O(1)** | Encrypt root folder's keys with new user's public key |
| Unshare from a folder tree | **O(1)** | Delete user's key entry. Re-encrypt on next access by remaining collaborator. |

### Filesystem Structure

Parent-child relationships are expressed only via UUIDs — never revealing document titles or metadata to the server.

---

## 5. Sharing Model

### Share a Single File

```
1. Alice retrieves Bob's public encryption key
2. Alice encrypts session_key with Bob's public key
3. Alice signs the encrypted key (proves authenticity)
4. Server stores Bob's encrypted copy of session_key
5. Bob decrypts session_key with his private key → can access the file
```

### Share an Entire Folder (O(1))

```
1. Alice encrypts root folder's private_hierarchical_key + session_key with Bob's public key
2. Bob can now recursively decrypt every descendant file/folder
```

### Unshare

```
1. Delete Bob's encrypted key copies from the file/folder's key register
2. On next access by any remaining collaborator, re-encrypt with new session key
   (ensures Bob can't access future versions even with cached keys)
```

### Link Sharing (E2E Encrypted Links)

Skiff implemented link sharing that maintains E2E encryption — even the server can't access the shared file:

```
1. Alice generates random link_key
2. Encrypts session_key with link_key
3. Encrypts link_key with session_key (for Alice to recover the link later)
4. Computes SRP salt + verifier from link_key
5. Stores encrypted keys + SRP data on server

Link URL: https://app.example.com/file/<fileID>#<link_key>

The #fragment is never sent to the server (browser standard).
```

**Recipient flow:**
```
1. Parse URL → extract link_key from fragment
2. Perform SRP authentication using link_key
3. Server returns encrypted session_key
4. Decrypt session_key with link_key → access file
```

### Expiring Access

Permissions can include an authenticated `expiry_date`. After expiry:
- Server blocks the expired user from accessing the file
- Next accessing collaborator re-encrypts with a new key
- Expired user cannot access future versions

---

## 6. SRP Authentication Protocol

### Why SRP (Secure Remote Password)?

In a traditional auth system, the server sees your password (at least briefly in memory). For an E2E encrypted product, the password derives the key that protects all private keys — if compromised, an attacker gets **everything**. SRP ensures the password never exists anywhere except the user's browser.

| | Traditional (bcrypt) | SRP |
|---|---|---|
| Password on the wire | Yes (over TLS) | Never |
| Password in server RAM | Yes (during hashing) | Never |
| Server compromise reveals password | Hash (crackable) | Verifier (not crackable) |
| Mutual authentication | No | Yes |

### Registration Flow

```
1. User enters email + password
2. Client: password → Argon2id → HKDF → srp_key + password_derived_secret
3. Client: srp_key → compute SRP salt + verifier
4. Client: generate Curve25519 + Ed25519 keypairs
5. Client: encrypt private keys with password_derived_secret → encrypted_user_data
6. Send to server: email, salt, verifier, encrypted_user_data, public_keys
```

The server stores the verifier (not a password hash), salt, and encrypted blob. It can never derive the password from any of these.

### Login Handshake (4 Round Trips)

```
Step 1: Client → Server
  Send: email, A (client's ephemeral public value)

Step 2: Server → Client
  Server looks up stored salt + verifier
  Send: salt, B (server's ephemeral public value)

Step 3: Both sides independently compute shared session key S
  Client uses: srp_key + A + B
  Server uses: verifier + A + B
  If password correct → both arrive at same S

Step 4: Client → Server
  Send: M1 (proof client knows S)

Step 5: Server → Client
  Send: M2 (proof server knows S) + JWT + encrypted_user_data

Step 6: Client verifies M2, decrypts encrypted_user_data with password_derived_secret
  → Private keys now in browser memory. User is logged in.
```

At no point did the password, srp_key, or password_derived_secret cross the wire.

### Libraries

- `secure-remote-password` (npm) — SRP-6a implementation, client + server packages
- Handles the math; you handle the transport

---

## 7. Password Change Flow

### Key Insight

The password doesn't encrypt files — it encrypts **private keys**. Changing a password only means re-wrapping one small blob, not re-encrypting every file.

### What Changes vs What Stays the Same

| Changes (re-derived) | Stays the Same |
|---|---|
| New Argon2id output | Same private keys (inside the blob) |
| New password_derived_secret | Same public keys |
| New encrypted_user_data | Same file session keys |
| New srp_key → new salt + verifier | Same encrypted files |

### The Flow

```
1. User is currently logged in (private keys in browser memory)
2. User enters old password + new password
3. Client verifies old password by re-deriving password_derived_secret
   and confirming it can decrypt encrypted_user_data
4. Derive new keys from new password:
   New password → Argon2id → HKDF → new srp_key + new password_derived_secret
5. Re-encrypt same private keys with new password_derived_secret
   → new encrypted_user_data
6. Compute new SRP verifier from new srp_key → new salt + verifier
7. Atomic server update: replace salt, verifier, encrypted_user_data
8. Invalidate all existing JWTs/sessions
```

### Pseudocode

```javascript
async function changePassword(oldPw, newPw) {
  // 1. Verify old password
  oldMaster = await argon2id(oldPw, storedSalt)
  { oldPDS } = hkdf(oldMaster)
  assert(canDecrypt(encryptedUserData, oldPDS))

  // 2. Derive new keys
  newSalt = randomBytes(32)
  newMaster = await argon2id(newPw, newSalt)
  { newSrpKey, newPDS } = hkdf(newMaster)

  // 3. Re-wrap same private keys
  newEncUserData = secretbox(privateKeys, newPDS)

  // 4. New SRP verifier
  { salt, verifier } = srpCreateVerifier(newSrpKey)

  // 5. Atomic server update
  await api.updateAuth({ salt, verifier, newEncUserData })
}
```

### Recovery Key Update

On password change, re-generate a new recovery key and re-encrypt private keys with it. Prompt user to save the new recovery key.

### Edge Cases

| Scenario | Handling |
|---|---|
| Browser crash mid-change | Old password still works — server update is atomic |
| Multiple active sessions | Other sessions hold stale JWTs, rejected on next request. Must re-auth with new password. |
| Forgot old password | Cannot change without old password. Must use recovery key flow instead. |
| Lost password + lost recovery key | **Unrecoverable.** Files permanently inaccessible. Fundamental tradeoff of E2E encryption. |

---

## 8. Account Recovery

### Recovery Key Setup

When a user enables account recovery:
1. A random symmetric `recovery_key` is generated
2. Private keys are encrypted with the `recovery_key` (separate from password encryption)
3. A hash of the `recovery_key` is stored on the server
4. The `recovery_key` is displayed to the user to save (like a crypto wallet seed phrase)

### Recovery Flow

```
1. User enters email, recovery key, and new password
2. Client hashes recovery key → sends hash to server
3. Server verifies: hash matches stored recovery key hash + email code verification
4. Server sends recovery-encrypted user data to client
5. Client decrypts private keys with recovery key
6. Client derives new password_derived_secret from new password
7. Client re-encrypts private keys with new password_derived_secret
8. Atomic server update (same as password change)
```

### Future Enhancement: Shamir Secret Sharing

Skiff's whitepaper mentions using 2-of-3 Shamir Secret Sharing:
- One share on user's device
- One share stored by server
- One share on paper (backup)

Any 2 of 3 shares can recover the key, improving usability without breaking E2E encryption.

---

## 9. UI & Design References

### Skiff's Design Language

Reviewers compared Skiff's UI to Apple Music and iCloud Drive — clean, minimal, well-organized with plenty of whitespace. The layout used:

- **Left sidebar:** Navigation (Drive, Pages, Search, Settings)
- **Main content area:** File list table with sortable columns (Name, Type, Size, Last Modified)
- **Toolbar:** Share and Upload buttons
- **File type icons:** Type-specific icons (folder, docx, png, code, xls, mp3, zip, page)
- **Storage indicator:** Usage bar (e.g., "2.3 of 10 GB used")
- **Dark/light mode:** Full theme support with token-based color system

### Live Design Resources (still accessible as of March 2026)

| Resource | URL | Notes |
|---|---|---|
| Drive marketing page (product mockup) | https://skiff.com/drive | Interactive product UI mockup showing full Drive layout |
| Design system docs | https://skiff.com/ui | Component documentation with live examples |
| Color tokens | https://skiff.com/ui/color | Base palette, light tokens, dark tokens |
| Component library source | https://github.com/skiff-org/skiff-ui | MIT licensed React components |
| npm package | @skiff-org/skiff-ui | Install locally to render components |
| UI screenshot archive | https://refero.design/306-skiff.com | Third-party full-page captures |

### Design System Components (MIT Licensed)

Avatar, Banner, Button, ButtonGroup, Chip, CircularProgress, Color, Divider, Dropdown, Facepile, IconButton, IconText, InputField, Select, Toggle

### Color System

Token-based with CSS variables. Accent colors: green, orange, red, yellow, pink, dark-blue, blue. Text colors: primary, secondary, tertiary, disabled, destructive, link, inverse, white, black.

**⚠️ These pages could disappear at any time since Skiff is shut down. Consider saving local copies.**

---

## 10. Proposed Tech Stack

| Layer | Technology | Role |
|---|---|---|
| **Frontend** | Next.js | App shell, routing, SSR for marketing pages |
| **Client-side crypto** | tweetnacl-js | Curve25519 keypairs, xsalsa20-poly1305 encryption/decryption |
| **Key derivation** | argon2-browser (WASM) | Argon2id password → master key |
| **Key splitting** | @noble/hkdf | HKDF to split master key into srp_key + password_derived_secret |
| **Auth protocol** | secure-remote-password (npm) | SRP-6a client + server implementation |
| **Auth server** | Cloudflare Workers | SRP handshake endpoints, JWT issuance, session management |
| **Metadata DB** | Supabase Postgres | Encrypted metadata, key registers, folder hierarchy, permissions (all values are ciphertext) |
| **Blob storage** | Cloudflare R2 | Encrypted file blobs (opaque bytes, S3-compatible, no egress fees) |
| **Email (transactional)** | Resend | Account verification, recovery codes |
| **Deployment** | Cloudflare / Vercel | Edge deployment for Workers + Next.js |

### Auth Architecture Decision

**Recommended: Supabase as data store only, custom auth via Cloudflare Workers.**

Rationale: For an E2E encrypted product, Supabase Auth's value proposition (magic links, OAuth, password resets) doesn't apply. Users auth via SRP and recover via recovery keys. Using Supabase purely as Postgres with service-role access is simpler and gives full control over the SRP handshake. No Supabase RLS (you handle authorization in the Worker).

---

## 11. Database Schema

```sql
-- Users table
users (
  id              uuid PRIMARY KEY,
  email           text UNIQUE NOT NULL,
  srp_salt        text NOT NULL,
  srp_verifier    text NOT NULL,
  encrypted_user_data  text NOT NULL,      -- private keys encrypted with password_derived_secret
  public_encryption_key text NOT NULL,     -- Curve25519 public key
  public_signing_key    text NOT NULL,     -- Ed25519 public key
  recovery_key_hash     text,              -- hash of recovery key (if enabled)
  recovery_encrypted_data text,            -- private keys encrypted with recovery key
  created_at      timestamptz DEFAULT now()
)

-- Files and folders
files (
  id              uuid PRIMARY KEY,
  owner_id        uuid REFERENCES users(id),
  parent_id       uuid REFERENCES files(id),  -- null = root level
  encrypted_metadata    text NOT NULL,         -- name, icon, timestamps encrypted with session_key
  public_hierarchical_key  text NOT NULL,      -- Curve25519 public key for this file/folder
  encrypted_hierarchical_private_key text,     -- encrypted with parent's public_hierarchical_key
  parent_keys_claim     text,                  -- child's keys encrypted with parent's public hierarchical key
  is_folder       boolean DEFAULT false,
  created_at      timestamptz DEFAULT now()
)

-- Per-user encrypted session keys
file_keys (
  file_id         uuid REFERENCES files(id),
  user_id         uuid REFERENCES users(id),
  encrypted_session_key text NOT NULL,         -- session_key encrypted with user's public key
  signature       text NOT NULL,               -- signed by sharer's signing key
  PRIMARY KEY (file_id, user_id)
)

-- File content chunks
file_chunks (
  id              uuid PRIMARY KEY,
  file_id         uuid REFERENCES files(id),
  sequence        integer NOT NULL,
  is_final        boolean DEFAULT false,
  encrypted_content text NOT NULL,             -- encrypted with session_key
  chunk_signature text NOT NULL,               -- authenticates sequence + is_final + content
  storage_key     text NOT NULL,               -- R2 object key for the encrypted blob
  UNIQUE (file_id, sequence)
)

-- E2E encrypted share links
share_links (
  id              uuid PRIMARY KEY,
  file_id         uuid REFERENCES files(id),
  srp_salt        text NOT NULL,
  srp_verifier    text NOT NULL,
  encrypted_session_key text NOT NULL,         -- session_key encrypted with link_key
  permission      text DEFAULT 'view',         -- 'view' or 'edit'
  expiry_date     timestamptz,
  created_at      timestamptz DEFAULT now()
)
```

---

## 12. Implementation Phases

### Phase 1 — Core Encryption (Hardest Part)

- Key generation (Curve25519 + Ed25519 keypairs in browser)
- Argon2id derivation + HKDF key splitting
- `encrypted_user_data` storage and retrieval
- SRP registration + login via Cloudflare Worker endpoints
- Basic file encrypt/decrypt with tweetnacl secretbox
- Upload encrypted blob to R2, store metadata in Postgres
- Recovery key generation and setup

### Phase 2 — Filesystem

- Hierarchical keypairs per folder
- Folder tree with recursive decrypt
- Upload/download pipeline with chunking for large files
- Chunk authentication (sequence + terminal flag)
- Breadcrumb navigation, folder creation, move/rename

### Phase 3 — Sharing

- Public key exchange between users
- Per-user encrypted session key copies
- O(1) folder sharing via hierarchical keys
- Unshare + key rotation on next access
- E2E encrypted link sharing with URL fragments
- Expiring access

### Phase 4 — Product Polish

- File previews (images, PDFs, text — decrypted client-side)
- Encrypted search index (client-side index synced to server)
- Version history
- Team workspaces
- Storage quota + billing (Stripe)
- Google Drive import (client-side migration tool)
- Onboarding flow with recovery key save step
- Dark/light theme

### Difficulty Flags

| Feature | Difficulty | Notes |
|---|---|---|
| SRP alongside Supabase | Medium | Custom auth flow, non-trivial but well-documented |
| Hierarchical key management | Medium | Core of the filesystem model, must be correct |
| Encrypted search | **Very Hard** | Users expect search, but server can't see content. Requires client-side encrypted index. |
| Key loss = data loss | UX challenge | Must communicate clearly. Recovery key onboarding is critical. |

---

## 13. Competitive Landscape

| Product | E2E Encrypted | Free Tier | Open Source | Notes |
|---|---|---|---|---|
| Proton Drive | ✅ | 1 GB | Partial | Backed by Proton AG, large team, Swiss jurisdiction |
| Tresorit | ✅ | — | ❌ | Enterprise-focused, expensive |
| Filen | ✅ | 10 GB | ✅ | Closest indie competitor, Germany-based |
| Internxt | ✅ | 1 GB | ✅ | Spain-based, blockchain-adjacent branding |
| pCloud (Crypto) | ✅ (add-on) | 10 GB (no E2E) | ❌ | E2E is paid add-on, not default |
| Google Drive | ❌ | 15 GB | ❌ | Dominant, no E2E |
| Dropbox | ❌ | 2 GB | ❌ | No E2E |

### Potential Differentiators for a Solo Build

- Developer-focused (API access to encrypted storage)
- Transparent, auditable encryption (open whitepaper, open-source client)
- Sharp indie positioning (privacy without enterprise bloat)
- Lower price point than Tresorit
- Specific niche targeting (e.g., journalists, lawyers, crypto users)

---

## 14. Key Risks & Tradeoffs

### Security Burden

This is the heaviest security responsibility a solo dev can take on. You are custodian of people's private files. Key management mistakes mean **permanent, unrecoverable data loss** — not just inconvenience.

### The E2E Tradeoff Triangle

```
Pick two:
  ┌─────────────────┐
  │   E2E Encrypted  │
  └───────┬─────────┘
          │
  ┌───────┴─────────┐
  │   Easy Recovery  │──── vs ──── Server-side Features
  └─────────────────┘              (search, previews, AI, etc.)
```

- E2E + Easy Recovery = server has keys (not truly E2E)
- E2E + Server Features = server can read data (not truly E2E)
- E2E + True Zero-Knowledge = hard recovery, limited server-side features

### Specific Risks

| Risk | Mitigation |
|---|---|
| User loses password + recovery key | Clear onboarding, forced recovery key save, future Shamir sharing |
| Crypto implementation bug | Use audited libraries (tweetnacl, argon2), never roll your own crypto |
| SRP implementation error | Use `secure-remote-password` npm package, test extensively |
| Server compromise | By design, server only has encrypted blobs + verifiers. No plaintext exposure. |
| Client-side performance | Large files need chunked encrypt/decrypt. Web Workers for off-main-thread crypto. |
| Competing with Proton Drive | Differentiate on developer focus, pricing, or niche targeting |

---

## 15. Resource Links

### Skiff Whitepaper & Documentation

- Whitepaper (2023, PDF): https://skiff-org.github.io/whitepaper/Skiff_Whitepaper_2023.pdf
- Whitepaper (2021, PDF): https://skiff-org.github.io/whitepaper/Skiff_Whitepaper_2021.pdf
- Security model overview: https://skiff.com/security-model
- Releases & hosted content: https://skiff-org.github.io

### Skiff Repositories

- Main monorepo (CC-BY-NC-SA): https://github.com/skiff-org/skiff-apps
- UI component library (MIT): https://github.com/skiff-org/skiff-ui
- Typed envelopes (AGPL): https://github.com/skiff-org/typed-envelopes
- Cipher (MIT): https://github.com/skiff-org/cipher
- Windows app (AGPL): https://github.com/skiff-org/skiff-windows-app

### Design System (Still Live)

- Drive product page (UI mockup): https://skiff.com/drive
- Design system docs: https://skiff.com/ui
- Color tokens: https://skiff.com/ui/color
- Component quickstart: https://skiff.com/ui/quickstart
- npm package: https://www.npmjs.com/package/@skiff-org/skiff-ui
- UI screenshot archive: https://refero.design/306-skiff.com

### Crypto Libraries (for Implementation)

- tweetnacl-js: https://www.npmjs.com/package/tweetnacl
- secure-remote-password: https://www.npmjs.com/package/secure-remote-password
- argon2-browser: https://www.npmjs.com/package/argon2-browser
- @noble/hkdf: https://www.npmjs.com/package/@noble/hkdf

### Background Reading

- Notion acquires Skiff (TechCrunch): https://techcrunch.com/2024/02/09/notion-acquires-privacy-focused-productivity-platform-skiff/
- Skiff shutdown analysis: https://blog.notesnook.com/the-skiff-privacy-fiasco
- SRP protocol spec (Stanford): http://srp.stanford.edu/
- Web Crypto API (MDN): https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API

---

*Document compiled March 2026. Skiff marketing pages and design system docs may go offline at any time — save local copies.*
