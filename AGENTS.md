<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# SecureWarp — project rules

## Crypto is the product

This app is a zero-knowledge encrypted drive. The server must **never** see
plaintext file content, plaintext filenames, the user's password, or any
derived key material beyond the SRP verifier and the public keys. If a change
would cause the server to handle any of those, stop and flag it — it is not a
bug fix, it is a product-level regression.

Client-side primitives are fixed: xsalsa20-poly1305 (tweetnacl), Argon2id,
HKDF-SHA256 (@noble/hashes), SRP-6a (secure-remote-password), BIP39. Don't
swap them without a migration path for existing ciphertext and stored hashes.

## Touching `src/lib/crypto/**` or `src/lib/srp/**`

1. Read the module you're editing **and** its test file before changing
   anything. The tests document invariants (chunk reorder/truncation, HKDF
   domain separation, recovery hash ≠ encryption key, etc.).
2. Add or update a test for the behavior you're changing. `npm test` must
   stay green.
3. If you change the HKDF `salt` or `info` string, the function name, or the
   ciphertext layout, you have silently invalidated every existing user's
   data. Version the constants (e.g. `-v2`) and keep the old path available
   until a migration is run.

## Server routes

- All API handlers live under `src/app/api/**/route.ts` and follow the
  Next.js App Router conventions documented in `node_modules/next/dist/docs/`.
- Validate every request body with Zod (`safeParse`, return `400` on
  failure). Never trust `body as T`.
- Use `logError("<route-tag>", err)` from `@/lib/log` instead of raw
  `console.error`. It produces structured single-line JSON logs and avoids
  leaking request payloads.
- Auth endpoints must not reveal whether an email exists — return the same
  generic error for "no such user" and "wrong password".
- Rate-limit any endpoint that takes a secret guess (login, recovery) via
  `checkRateLimit(...)`. It's async now — don't forget to `await`.

## Database conventions

- Access Supabase through `@/lib/db/supabase` with the service-role client.
  RLS is enabled on every table as belt-and-braces but the service role
  bypasses it, so correctness lives in the API layer.
- Filter `files` queries by `upload_complete = true` on any read path that
  exposes rows to users. `getFilesForUser` and `getFileById` already do this;
  new readers must match.
- New tables: add the migration SQL to `README.md` under the migrations
  block. Don't rely on the Supabase dashboard alone.
- If you add a Postgres function, set an explicit `SET search_path` clause
  to silence the `function_search_path_mutable` advisor.

## Tests

- Run `npm test` before declaring any crypto/auth change complete.
- Tests live next to the source: `src/lib/crypto/keys.ts` ↔
  `src/lib/crypto/keys.test.ts`.
- Vitest runs in the Node environment — `crypto.subtle` and the Web Crypto
  primitives are available globally in Node 20+, so the client-side modules
  are tested with the same code paths that run in the browser.

## Sharing invariants (Phase 3 — hierarchical keys + folder inheritance)

The crypto model is Skiff's two-layer design. Every file has:

- a symmetric `sessionKey` (encrypts content + metadata), and
- an asymmetric `hierarchicalKeyPair` generated client-side.

The session key is wrapped **once** to the file's `publicHierarchicalKey`
with the owner as the `nacl.box` sender. It is never re-wrapped for new
collaborators. Each collaborator's `file_keys` row holds the file's
*private* hierarchical key wrapped to that user's public encryption key.

**Invariants that must not be violated**:

1. **The plaintext session key only exists on the client, briefly, during
   upload/download/metadata-decrypt.** Zero it with `.fill(0)` as soon as
   you're done. Never serialize it, never log it, never put it in a
   request body. The only place it gets wrapped is `wrapSessionKeyToFile`
   in `src/lib/crypto/file-crypto.ts`.

2. **The plaintext private hierarchical key only exists on the client,
   briefly, during a share or a decrypt.** Same rules as above. Only
   `wrapPrivateHierarchicalKeyForUser` is allowed to touch it.

3. **The `wrapped_by_public_key` column on a `file_keys` row is the box
   sender for *that specific row*.** For an owner-created row it's the
   owner's public key; for a collaborator re-share it's the sharer's.
   Don't conflate it with `files.owner_id → users.public_encryption_key`
   (which is the box sender for the *session-key-to-file* wrap). These
   two sender keys can differ; the client needs both.

4. **Non-owners can re-share.** `POST /api/files/share` gates on
   `getFileById(fileId, session.userId)` (does the caller have a
   file_keys row), not on ownership. If you ever tighten that, you break
   the Phase 2 guarantee that whoever holds the private hier key can
   grant. Conversely: never let `share` accept a caller without a row —
   that would let outsiders drop new keys.

5. **Only `/delete` is owner-only.** `share` is any-collaborator.
   `unshare` is owner-or-self (the self-path is how a viewer "leaves").
   `leave` is explicitly not-owner. `permission` is owner-only. Don't
   collapse these into one endpoint.

6. **Revocation is not forward-secret.** `unshare`/`leave` only delete
   the ACL row — no hier keypair, session key, or `parent_keys_claim`
   gets rotated. A user who previously unwrapped and cached the private
   hier key keeps decrypt capability. Phase 5 will rotate on revoke.

7. **Folder inheritance via `parent_keys_claim` (Phase 3).** Every file
   with a parent stores a claim blob wrapping
   `{sessionKey, childPrivateHierarchicalKey}` under the **parent's**
   public hierarchical key, with the owner's private encryption key as
   the box sender. Anyone who can unwrap the parent's private hier key
   transitively unwraps every descendant without any ACL fan-out.

   Subrules:
   - The box sender for a `parent_keys_claim` is stored explicitly in
     `parent_keys_claim_wrapped_by` (the owner at upload time). Don't
     re-derive it from `files.owner_id → users.public_encryption_key`
     today and hope it keeps matching after ownership transfers land.
   - The **owner always has a direct `file_keys` row** on every file
     they own. `getFilesForUser` relies on this. Don't remove the
     owner's row as an "optimization" — it breaks the fast decrypt
     path and the `getFileById` access gate.
   - Inherited children MAY have no direct `file_keys` row for a given
     user. List endpoints that return inherited children must
     left-join on file_keys, never inner-join. `getInheritedChildren`
     is the canonical implementation; copy its pattern.
   - **Don't recurse on unshare/leave.** Removing a user from a parent
     folder deletes only that row. If they also have a direct row on
     some child, they keep child access via the direct row. If they
     have *only* the parent row, losing it also loses every inherited
     descendant automatically — nothing else to do.

## Phase 4 invariants — public link sharing

Links live in their own `file_links` table, **not** in `file_keys`. The
wrap is symmetric (`nacl.secretbox`), not asymmetric (`nacl.box`). The
`linkKey` is a fresh 32-byte random blob generated in the browser,
shipped to the visitor via the URL fragment, and never touches the
server.

8. **`/share/[id]/page.tsx` must stay `"use client"`** and must never
   call `getSession()`, `cookies()`, or any other authenticated helper.
   The whole point of the page is that an anonymous visitor can render
   it. If you add SSR logic here, you break the invariant that a link's
   viewer is not a registered user.

9. **`linkKey` never leaves the browser.** It lives only in
   `window.location.hash`. Do not log it, do not persist it, do not send
   it in any request body or query string. The `createLink` hook returns
   it exactly once at creation time; after that the only copy is in the
   URL the user copied. Matches Skiff's "links cannot be retrieved"
   design — don't add a "get my existing link" endpoint.

10. **Every anonymous link route must call `assertLinkCovers(link,
    targetFileId)`** before returning any file data. A link to folder A
    must not grant access to sibling folder B, even at the same DB
    access level. The helper walks up from the target through
    `parent_id` to find the link's file — centralized in
    `src/lib/auth/link-access.ts`.

11. **File links vs. file_keys.** Don't add `file_links` joins to
    `LIST_SELECT` or any path that serves registered users. `file_keys`
    is per-user asymmetric grants; `file_links` is per-link symmetric
    wraps — different tables, different wrap semantics, different
    lifetimes.

12. **Revocation is not forward-secret.** Setting `revoked_at` stops
    new fetches but doesn't invalidate cached ciphertexts held by a
    recipient who already visited the link. Phase 5 will rotate the
    linkKey + re-wrap content on revoke.

14. **Forward-secret revocation is a separate flow (Phase 5).**
    `unshare`/`leave` is still the fast ACL-only path. The
    cryptographic rotation lives in `rotateAndRevoke` on the client +
    `/api/files/[id]/rotate-init` and `/rotate-commit` on the server.
    The rotate-commit endpoint MUST validate that
    `remainingCollaborators ∪ {revokedUserId}` equals the current
    `file_keys` set to prevent the client from sneaking in an
    unauthorised grant. The owner MUST remain in the collaborator set.
    For FOLDERS, the flow is different — see rule 15.

15. **Folder shallow rotation (Phase 5.1)** lives in its own pair of
    endpoints: `/api/files/[id]/folder-rotate-context` (GET) and
    `/api/files/[id]/rotate-folder-commit` (POST). The client-side
    entrypoint is `rotateAndRevokeFolder` in `use-files.ts`.

    Invariants the commit endpoint enforces:
    - Caller owns the folder AND `is_folder = true`.
    - `revokedUserId != caller.userId`.
    - `remainingCollaborators ∪ {revokedUserId}` exactly equals the
      current `file_keys` set on the folder (409 on drift).
    - `rewrappedChildren` exactly equals the current **direct-child**
      set on the folder (409 on drift). Every id in the payload must
      have `parent_id === folderId` — prevents a malicious client
      from updating grandchildren or siblings via this endpoint.
    - Owner must remain in `remainingCollaborators`.

    **Shallow invariant**: only direct children's `parent_keys_claim`
    and `parent_keys_claim_wrapped_by` columns are mutated.
    Grandchildren and deeper are NEVER touched — their claims are
    encrypted under their own parent's (unchanged) pub hier key, so
    the chain self-heals. This is the point of "shallow".

    **Write order is load-bearing** (see `rotate-folder-commit`
    header comment): folder row first, then remaining collaborators'
    file_keys, then direct children's claims, then delete revoked
    user. Every step is idempotent so a mid-sequence crash recovers
    via a simple client retry on the same payload. Don't reorder.

    **Known limitation** (README also covers this): cached descendant
    session keys and priv hier keys held by a revoked user remain
    usable against that specific cached copy. Full recursive
    re-encryption would require downloading and re-uploading every
    chunk in the subtree, which is deferred indefinitely. Document
    in any user-facing copy that folder revoke is "forward-secret
    for new and unopened files."

13. **Password-protected links (Phase 4.1).** When
    `file_links.password_salt IS NOT NULL`, the link URL has no
    fragment — the password is the sole key material. The Argon2id
    derivation uses `@noble/hashes/argon2` (Node + browser compatible)
    with `{ t: 2, m: 32 MB, p: 1, dkLen: 32 }`. Don't swap these
    parameters without a migration path: the stored ciphertexts can
    only be unwrapped with the exact same derivation that wrapped
    them. The plaintext password never reaches the server — the only
    server-side witness is the salt (which is random and useless
    alone) and the wrapped ciphertext.

## Touching the sharing surface — checklist

Before changing any of `src/lib/crypto/file-crypto.ts`,
`src/app/api/files/share/route.ts`, `src/app/api/files/list/route.ts`,
or `src/hooks/use-files.ts`:

- Read `src/lib/crypto/hierarchical.test.ts` — it documents the exact
  wrap/unwrap invariants with tiny runnable scenarios. Update it if the
  semantics change.
- Re-run `npm test` — the hierarchical suite catches "oh I forgot which
  public key goes where" bugs immediately.
- The server must **never** learn the private hierarchical key or the
  plaintext session key. If a code path would need it, redesign.

## Lock cache / unlock flow (tab-reopen session resume)

The decrypted private keys live in `sessionStorage`, which is wiped
when the tab closes. The auth JWT is a 7-day cookie, so without any
cache a returning user is "logged in" per the server but has no keys
to decrypt anything. `src/lib/auth/lock-cache.ts` persists an encrypted
snapshot of the four key strings in `localStorage`, unsealable with
the password alone — no SRP, no server round-trip.

16. **`unlockCacheKey` is a third HKDF output of `splitMasterKey`.**
    The info string is `securewarp-unlock-cache-v1`. Never reuse
    `srpKey` or `passwordDerivedSecret` for this purpose — domain
    separation is what makes a disk-level attacker with the cache
    blob equivalent (not worse) than an attacker with the SRP
    verifier. If you ever change the info string or Argon2 params,
    version the constant (`-v2`) and invalidate existing blobs.

17. **The cache blob contains only ciphertext + non-secret metadata.**
    `email` and `argon2Salt` are stored plaintext alongside — the
    salt is the same one the server sends during login/init, and
    the email is visible on the unlock screen anyway. The four key
    strings are inside a `nacl.secretbox` under `unlockCacheKey`.

18. **Lifecycle: save on login/signup/recover, clear on logout/change.**
    `use-auth.ts` calls `saveLockCache` after every successful key
    derivation (login, signup, recover, changePassword) and
    `clearLockCache` on logout and before re-sealing under a new
    password. If you add a new auth path, you MUST wire both sides.
    Missing a `clearLockCache` on password change leaves a blob
    that unlocks with the OLD password.

19. **`unlockCacheKey` is zeroed in `finally`.** `use-auth.ts`'s
    `unlock(password)` and all the save-site callers hoist
    `unlockCacheKey` so it can be `.fill(0)`'d on every exit path.
    Same hygiene as `passwordDerivedSecret` in the login flow.

20. **Drive renders AuthScreen inline when `sessionStorage` is empty.**
    `src/components/drive-client.tsx` cannot redirect to `/login` —
    the middleware would bounce authenticated users right back. It
    inlines `<AuthScreen />` instead; AuthScreen auto-detects the
    lock cache and shows the unlock form. After a successful unlock
    the hook dispatches a `securewarp-keys-updated` window event,
    which drive-client listens for and re-reads sessionStorage. Do
    NOT add a `router.push` to /drive from unlock — it's a no-op
    when you're already there and hides the event wiring.

## Security hardening rules

- **Email canonicalization.** Every auth boundary (register, login,
  recover) MUST pass the request email through
  `normalizeEmail` from `@/lib/auth/email` before using it for a
  database lookup, a rate-limit key, or an SRP session row. The DB
  `users.email` unique constraint is case-sensitive; without
  normalization two users could register as `a@x.com` and `A@x.com`,
  and an attacker could cycle rate-limit buckets by case.

- **Rate limiter fails closed.** `checkRateLimit` returns `false` on
  RPC failure. Don't flip this. SRP-6a bounds online guessing but the
  limiter is still the primary defence against password spraying and
  recovery-token enumeration; fail-open during an outage is worse than
  a temporary login outage that forces the operator to look.

- **`folderPrivHierCache` lifecycle** (`src/hooks/use-files.ts`). The
  cache holds plaintext private hierarchical keys. It MUST be wiped on
  `keys` identity change and on hook unmount. Never persist it, never
  serialise it, never expose it on `window`. If you add a new caller
  for the hook that survives across user sessions, you MUST manually
  clear the cache when the active user changes.

- **Typed-array secrets are zeroed in `finally` blocks.** Session keys
  are `Uint8Array` and must be `.fill(0)`'d on every exit path in the
  upload/download/rotate flows. Strings (base64 priv hier keys) can't
  be zeroed — that's a tradeoff; don't extend the string-secret
  surface area. Hoist the typed array outside the `try` block so a
  single `finally` covers both success and error paths.

- **`isDescendantOf` throws on depth overflow** rather than returning
  false. Silent false-returns hide data-corruption bugs that would
  otherwise surface to operators. The cycle case shouldn't be
  reachable today (the create flow can't introduce one), but the
  throw gives us a loud alarm if it ever does.

## Don't

- Don't add telemetry, analytics, or logging that includes request bodies,
  headers beyond `Authorization`, or anything derived from user keys.
- Don't store derived passwords server-side. The only acceptable secret on
  the server is the SRP verifier and the recovery verification hash.
- Don't introduce a "backup" or "export" flow that bypasses client-side
  encryption.
- Don't amend a published migration — add a new one.
