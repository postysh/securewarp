# SecureWarp — Library & Architecture Recommendations

**Prepared:** April 22, 2026
**Context:** Zero-knowledge E2E encrypted drive, Next.js 16 / Vercel / Supabase / Cloudflare R2, Crypto v2 (2026-04-20) based on `@noble/*`, SRP-6a, XChaCha20-Poly1305, hierarchical keys (Skiff model), and the invariants documented in `AGENTS.md`.

This document is written against the actual SecureWarp codebase as it exists today — not a greenfield project — so the recommendations are ordered by (a) how much they matter for your threat model, and (b) how cheap they are to adopt given your current architecture. Where I'm recommending you **keep** what you have, I say so explicitly.

Every library recommendation includes: what it is, why I'm recommending it over alternatives, and where that judgment comes from.

---

## Executive summary

| Layer | Current choice | Recommendation | Verdict |
|---|---|---|---|
| Symmetric AEAD (file body) | `@noble/ciphers` XChaCha20-Poly1305 | **Keep** | Correct — aligned with Proton ChaCha20 usage, better nonce margin than AES-GCM |
| Asymmetric wrap | `@noble/curves` X25519 + HKDF + XChaCha20-Poly1305 | **Keep** | Clean-room Skiff model, no tweetnacl baggage |
| Password KDF | `argon2-browser` (WASM) | **Switch to `@phi-ag/argon2` or `hash-wasm`** | Both are faster, actively maintained, and SIMD-built |
| HKDF / SHA-256 | `@noble/hashes` | **Keep** | Industry standard, partially audited |
| aPAKE / zero-knowledge auth | `secure-remote-password` (LinusU) | **Consider migrating to `tssrp6a`** | LinusU fork hasn't shipped in 8 years; tssrp6a is active & typed |
| Identity signing (MISSING) | — | **Add `@noble/curves` Ed25519 + TOFU key pinning** | Biggest real threat-model gap |
| Upload protocol | Custom chunked POST | **Consider `tus-js-client` + `@tus/server` or move to R2 multipart** | Current path works; tus gives free resumability |
| Download streaming | Direct `fetch` | **Add File System Access API + `native-file-system-adapter` fallback** | Avoids Blob RAM cap, streams to disk |
| Worker RPC | (not documented) | **`comlink`** | De facto standard |
| File preview (current) | In-house allowlist + isolated viewer subdomain | **Keep** | Your architecture here is already ahead of most competitors |
| Third-party audit | — | **Budget for Cure53 or Radically Open Security once past MVP** | Single highest-leverage trust signal |
| OPAQUE / post-quantum auth | — | **Don't migrate — track only** | Not mature enough for production E2E storage yet |

The short version: your crypto primitive choices are correct. The biggest real gaps are (1) the missing Ed25519 identity-signing layer, (2) the aging `secure-remote-password` library, and (3) some performance headroom on Argon2id that you can claim cheaply.

---

## 1. Symmetric encryption — keep `@noble/ciphers` (XChaCha20-Poly1305)

### Recommendation: Keep what you have.

Your current path — `@noble/ciphers` exporting `xchacha20poly1305` — is the right library for the right primitive.

**Why XChaCha20-Poly1305 over AES-GCM:** The 192-bit nonce makes random nonce generation collision-safe across millions of file chunks, which is specifically the situation you're in (per-file session keys, chunked file bodies, per-version wraps). AES-GCM's 96-bit nonce does not have that property, and GCM nonce reuse is catastrophic (recovers the authentication key). ChaCha20-Poly1305 is faster than AES-GCM on systems without AES-NI hardware acceleration, which matters on mobile and older hardware [Wikipedia, "ChaCha20-Poly1305", 2026](https://en.wikipedia.org/wiki/ChaCha20-Poly1305). Proton Drive uses ChaCha20 internally [Proton VPN blog, "What is ChaCha20?", 2025](https://protonvpn.com/blog/chacha20).

**Why `@noble/ciphers` over libsodium.js:**

- **Pure JS, no WASM bootstrapping.** Works in every runtime (Node, browser, Workers, React Native) without an `await sodium.ready` dance. Important for Cloudflare Workers where WASM init is possible but fiddly [Nik Graf, "Choosing a Cryptography Library for JavaScript", 2024](https://www.nikgraf.com/blog/choosing-a-cryptography-library-in-javascript-noble-vs-libsodium-js).
- **Tree-shake friendly.** Libsodium.js is ~188KB minified+gzipped all-or-nothing [same source]. Noble ships per-algorithm imports, so your client ships only XChaCha20-Poly1305 + X25519 + HKDF, roughly an order of magnitude smaller.
- **Active audit trail.** Curves audited by Trail of Bits + Kudelski; hashes audited by Cure53. Ciphers and post-quantum packages are NOT fully audited — both libraries have this limitation, but Noble's author Paul Miller publishes self-audits and noble is used by Proton, Metamask, Rainbow, Phantom, Kraken [Paul Miller, "Noble cryptography", 2026](https://paulmillr.com/noble/).
- **Paul Miller claims it's the fastest JS implementation of ChaCha/Salsa/AES** [@noble/ciphers README, 2025](https://github.com/paulmillr/noble-ciphers). I have not independently verified this, but there's no credible counter-benchmark I can find.

**Why not switch to WebCrypto AES-GCM:** WebCrypto is 2–15× faster than any JS library for AES-GCM on AES-NI hardware [Encryb, "Comparing Performance of JavaScript Cryptography Libraries", 2015 — old but still the clearest benchmark]. However, (a) you'd give up the 192-bit nonce safety of XChaCha20, (b) WebCrypto AES-GCM doesn't stream, so you'd hand-roll the chunk framing you already have via `@noble`, and (c) the dependency would split between WebCrypto for bodies and Noble for key wraps, which complicates audit and maintenance. The perf gap is negligible when encryption is pipelined with network upload anyway.

**Action items:**
- No change required.
- Confirm chunk size stays in the 1–4 MB band. Your README says 50 MB chunks, which is fine for R2 throughput but means more RAM pressure during decrypt and coarser resume granularity on interrupted downloads. Proton Drive splits into 4 MB chunks specifically to balance these [Proton Drive security page](https://proton.me/drive/security). If you haven't benchmarked 4 MB vs 50 MB, it's worth a measurement.

---

## 2. Asymmetric key wrap — keep X25519 + HKDF + XChaCha20-Poly1305

### Recommendation: Keep.

Your Crypto v2 (2026-04-20) rotation off `tweetnacl.box` onto an explicit `X25519 ECDH → HKDF-SHA256 → XChaCha20-Poly1305` chain is the right call and aligned with current best practice. It also closes a Skiff-era dependency: the ETH Zürich master's thesis on Proton Drive's OpenPGP model notes that Proton Drive itself runs ECDH-then-AEAD for payload wrapping [Backendal & Huigens, ETH Zürich thesis on Proton Drive](https://ethz.ch/content/dam/ethz/special-interest/infk/inst-infsec/appliedcrypto/education/theses/lea-micheloud-master-thesis.pdf).

This gives you three concrete benefits over `nacl.box`:
- **No xsalsa20 legacy.** tweetnacl is unmaintained (no releases in years), and its `nacl.box` ties you to Curve25519+xsalsa20-poly1305 forever.
- **Algorithm agility.** With the explicit chain you can rotate the KDF or AEAD independently without changing wire format semantics.
- **Single AEAD across the app.** File bodies and key wraps use the same primitive, which simplifies the audit surface.

**Action items:**
- No change required.
- When you do the signing-key work in section 4, wire Ed25519 via `@noble/curves/ed25519` so the dependency tree stays consistent.

---

## 3. Password KDF — switch from `argon2-browser` to `@phi-ag/argon2` or `hash-wasm`

### Recommendation: Migrate. This is the single highest-leverage performance win available.

Your current `argon2-browser` (antelle's package) is the reference WASM Argon2 and works, but it has not shipped a significant release in years and its WASM build is not SIMD-optimized by default [antelle/argon2-browser README](https://github.com/antelle/argon2-browser).

**Two modern alternatives, both meaningfully faster:**

**Option A: `@phi-ag/argon2`** [phi-ag/argon2 on GitHub, 2024+](https://github.com/phi-ag/argon2). Minimal SIMD-built Argon2 WASM. Its own published benchmarks show ~1.7× speedup over `hash-wasm` and substantially more vs. antelle's non-SIMD build. Runs in Node, Deno, Bun, browsers, and explicitly supports Cloudflare Workers.

**Option B: `hash-wasm`** [Daninet/hash-wasm on GitHub](https://github.com/Daninet/hash-wasm). Broader library (SHA family, BLAKE, Argon2, etc.) with hand-tuned WASM. Slightly slower than phi-ag on Argon2 but gives you a single dependency for Argon2 + any other hashes you need outside `@noble/hashes`.

**Why this matters for you specifically:**

At your current parameters (64 MB, 3 iterations per your README), Argon2id is ~500–800 ms on a modern laptop with antelle's build. A 1.5–2× speedup here shows up three places:
1. Login — direct user-facing latency on every login.
2. **Unlock-cache flow (invariant 16–20).** Every tab reopen runs Argon2id + HKDF + secretbox-open. This is the flow you deliberately optimized to avoid server round-trips; making it faster is pure win.
3. **Phase 4.1 password-protected links.** Every anonymous link visitor runs Argon2id on the browser. Right now that's `{ t: 2, m: 32 MB }` per your spec. Under load (e.g. a link goes semi-viral), this is the work the average visitor's laptop does before they see a file.

**Migration cost:** Low. The APIs are not identical but they are conceptually identical — you swap `hash({ pass, salt, mem, time, hashLen, type })` for the new library's equivalent. Bump the HKDF `info` constant to `-v3` so you can detect and re-derive if you ever change parameters.

**Critical compatibility note:** Argon2id is deterministic given `(password, salt, time, memory, parallelism, hashLen)`. As long as you use the same parameters and the same Argon2 variant (Argon2id), output is bit-identical across libraries. You do **not** need a re-registration migration. Verify with a test vector before shipping.

**One caveat on `hash-wasm`'s Argon2 specifically:** A `memorySize: 512` default example appears in their docs, which is *way* below OWASP minimums. Make sure you're passing your actual production parameters explicitly [hash-wasm README](https://github.com/Daninet/hash-wasm).

---

## 4. Identity signing — the missing piece. Add Ed25519 + TOFU pinning.

### Recommendation: This is the biggest real threat-model gap you have.

Your `users` table already has `public_signing_key` (Ed25519) alongside `public_encryption_key` (X25519), but I can't find the signing key being used on the share path, the file_keys wrap path, or the collaborator-lookup path.

**Why this matters:** Without signatures over identity bundles, a malicious or compromised server can MITM any cross-user share. When Alice calls `GET /api/users/public-key?email=bob@…`, the server can substitute its own X25519 public key. Alice wraps the file key to the server. The server re-wraps to Bob. Both parties see a "successful" E2E share, and the server has plaintext capability for that file. This is the exact attack Proton specifically built Proton Key Transparency to defend against [Proton Key Transparency whitepaper](https://proton.me/files/proton_keytransparency_whitepaper.pdf):

> "The Achilles heel of end-to-end encryption is getting the public key. To get it, the Proton client app looks up the recipient's username on a key server run by Proton, and the key server returns the public key."

The ETH Zürich analysis of Proton Drive specifically calls out "lack of consequences of failed signature checks can lead to powerful attacks, where an adversary who successfully inserts a folder in the file tree…" — signatures are the load-bearing defense here [Backendal & Huigens thesis, ETH Zürich](https://ethz.ch/content/dam/ethz/special-interest/infk/inst-infsec/appliedcrypto/education/theses/lea-micheloud-master-thesis.pdf).

**Recommended stack:**

- **`@noble/curves/ed25519`** for Ed25519 sign/verify. Already in your dep tree via `@noble/curves`. Audited [Paul Miller noble page](https://paulmillr.com/noble/).
- **TOFU (trust-on-first-use) key pinning** client-side. First time Alice shares with `bob@…`, pin Bob's signed identity bundle `{ x25519Pub, ed25519Pub, userId, fetchedAt }` in IndexedDB under `pinned_keys:<normalizedEmail>`. On every subsequent interaction, verify the fetched bundle matches the pinned one. On mismatch, show a hard-blocking "Bob's identity key has changed — verify out of band" modal (Signal-style safety number UI).
- **Self-signed identity bundle at registration.** Client generates both keypairs, signs `{ x25519Pub, ed25519Pub, userId, email, createdAt }` with the Ed25519 private key, and stores the signature on the `users` row. Anyone who fetches Bob's bundle verifies the self-signature against the Ed25519 public key they already have (or TOFU-pin).
- **Phase 5 rotation must re-sign.** When a user rotates keys (password change, recovery, device reset), the new bundle must be signed by the old Ed25519 key *and* the new one, producing an append-only key-history chain.

**What you're explicitly NOT doing (and should be honest about):** This is TOFU, not true key transparency. Proton's KT uses append-only Merkle trees with Certificate Transparency-style witnessing. That's months of implementation and operational work. TOFU gets you ~90% of the protection against server MITM for solo-dev effort. Document this tradeoff in SECURITY.md.

**Action items:**
- Wire Ed25519 sign/verify on: registration bundle, share flow, `file_keys` row creation, rotation commits, link creation.
- Add `pinned_keys:<email>` IndexedDB store and a "key changed" warning UI.
- Update SECURITY.md "We defend against" to include "server-side public key substitution" and "We do NOT defend against" to include "a first-ever share to a user who is server-MITM'd from the start" (the TOFU bootstrap gap).

---

## 5. aPAKE / zero-knowledge auth — migrate `secure-remote-password` → `tssrp6a`

### Recommendation: Plan a migration, but not urgently.

Your current library is LinusU's `secure-remote-password` [npm page](https://www.npmjs.com/package/secure-remote-password). It's a "modern SRP implementation for Node.js and Web Browsers." The problem is right there on npm: **latest version 0.3.1, last published 8 years ago.** That is not a library you want holding the wire-format and math for your zero-knowledge auth layer.

**Better alternative: `tssrp6a`** [midonet/tssrp6a on GitHub](https://github.com/midonet/tssrp6a). TypeScript-native, zero dependencies, uses `crypto.subtle` (so it runs in browser, Node 20+, Workers, Deno), active maintenance, clear API. It's what I'd start with today.

**Migration mechanics:**

SRP-6a is a protocol, not a library. Two libraries implementing SRP-6a against the same group (e.g. RFC 5054 2048-bit) with the same hash function (SHA-256) produce identical verifiers for the same `(salt, username, password)`. So:

1. Verify both libs use the same group + hash. LinusU's default is SHA-256 + RFC 5054 2048-bit. `tssrp6a` default is `new SRPRoutines(new SRPParameters())` which is also SHA-256 + 2048-bit.
2. Write a compatibility test: generate verifier with old lib, verify with new lib, and round-trip a full handshake.
3. If they match, you can swap the client library without invalidating existing verifiers. This is huge — no user-facing migration.
4. Keep the old lib on the server side until you've flipped the client, or swap both at once if you control the deploy.

**Don't migrate to OPAQUE.** Per our earlier discussion, RFC 9807 is 9 months old (July 2025), published as IRTF Informational with the disclaimer that the results "might not be suitable for deployment", and the only confirmed production deployment is WhatsApp + Facebook Messenger for chat-history backup (secret retrieval, not primary auth) [NIST Crypto Reading Club, Krawczyk talk 2024](https://csrc.nist.gov/Presentations/2024/the-opaque-password-protocol). Every competing E2E storage product (Proton, Tresorit, Filen, Internxt, MEGA) still uses SRP or a custom password-derived-key scheme. OPAQUE is worth tracking, not migrating to, until there's a mature audited browser/Node library and at least one peer product has shipped it.

**Note on `bsrp`:** Claims to be "used by 1Password, iCloud, AWS Cognito" [bsrp npm page](https://www.npmjs.com/package/bsrp) — that's SRP the protocol, not the library. Those companies implement their own. `bsrp` itself is also old.

**Note on `scirexs/srp6a`:** Modern TypeScript implementation but the README explicitly says [GitHub page](https://github.com/scirexs/srp6a):
> "This package includes security countermeasures such as constant-time comparisons and random delay insertion. However, it has never received an independent third-party security audit for correctness and security."

Not a deal-breaker but worth knowing. tssrp6a has the same disclosure, but is older and more widely used.

**Action items:**
- Write the compatibility test between `secure-remote-password` and `tssrp6a`.
- If verifiers match, swap client-side and server-side in a single deploy, keep the old lib as a fallback import for 30 days in case of rollback.
- Add a line to AGENTS.md noting the SRP library version and parameters so future agents don't silently rotate them.

---

## 6. Upload transport — consider tus; otherwise use R2 multipart properly

### Recommendation: The current setup works. If you want free resumability, adopt tus.

Your current approach appears to be: client-side chunked encryption → one POST per chunk → server proxies to R2 (via presigned URL or pass-through, unclear from the docs). This works but leaves three things on the table:

1. **Resume after network interruption.** If a 5 GB upload dies at 2.3 GB, your users restart from zero.
2. **Parallel chunk uploads.** tus supports parallel chunk PATCH via the Concatenation extension; R2 multipart supports parallel parts natively.
3. **Cloudflare tunneled uploads.** Uploads through Vercel serverless hit function time limits. Direct-to-R2 via presigned URLs avoids this entirely.

**Option A: Adopt tus**

- Client: [`tus-js-client`](https://github.com/tus/tus-js-client) v4 or [`@uppy/tus`](https://uppy.io/docs/tus/) if you want Uppy's UI.
- Server: [`@tus/server` v2](https://tus.io/blog/2025/03/25/tus-node-server-v200) with `@tus/s3-store` pointed at R2. Integrates cleanly into Next.js App Router.
- Supabase Storage runs tus in production [Supabase docs on resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads); Cloudflare Stream mandates tus for videos over 200 MB [Cloudflare Stream docs](https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/).

Cost: ~1 day of integration work, plus adjusting your chunk framing so the encrypted chunk boundaries align with tus PATCH boundaries.

**Option B: Stay on direct POST, use R2 multipart properly**

- Generate a presigned multipart upload URL per part from your Next.js API route.
- Upload parts in parallel (3–5 in flight) directly from the browser to R2.
- Cost: less code change than tus, but you lose automatic resumability — you'd implement that yourself using the multipart `uploadId` as the resume token [Cloudflare R2 multipart docs](https://developers.cloudflare.com/r2/objects/upload-objects/).

**My recommendation:** Option A if you expect many users on mobile or unreliable networks. Option B if your users are mostly desktop/stable-network and you want minimum code churn.

**Either way:** Move to direct-to-R2 presigned URLs and out of the Vercel function hot path. This is called out in every production upload design guide [Medium, "9 High-Scale File Upload Designs with S3, R2, and Signed URLs", 2025](https://medium.com/@ThinkingLoop/9-high-scale-file-upload-designs-with-s3-r2-and-signed-urls-ad1425ee85e8) and Cloudflare's own documentation [R2 upload objects docs](https://developers.cloudflare.com/r2/objects/upload-objects/).

---

## 7. Download streaming — File System Access API with graceful fallback

### Recommendation: Layered approach — FSA where available, StreamSaver elsewhere.

When a user downloads a 5 GB encrypted file, you have a choice:

1. **Buffer in RAM, hand to Blob URL.** Easy, works everywhere, fails hard above ~1–2 GB (browser RAM limits, mobile especially). This is what most apps do badly.
2. **Stream to disk.** Correct for your use case.

The right tool depends on browser:

**Primary path: File System Access API.**
[MDN File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API). The user picks a save location, you get a `FileSystemWritableFileStream`, you pipe your decrypted chunks to it. Chunk N+1 is decrypted while chunk N is being flushed to disk. No RAM spike.

Browser support as of early 2026 [Can I Use file-system-access](https://caniuse.com/native-filesystem-api):
- Chrome/Edge 131+: fully supported [LambdaTest FSA matrix](https://www.lambdatest.com/web-technologies/native-filesystem-api)
- Safari: partial support 15.2+ (showSaveFilePicker specifically is still spotty)
- Firefox: partial support on 113+ behind flags
- Mobile: spotty

Overall browser-compat score is ~30/100 per LambdaTest. Fine for the primary path, wrong to rely on exclusively.

**Fallback: `StreamSaver.js` or ponyfill.**

- [`StreamSaver.js`](https://github.com/jimmywarting/StreamSaver.js) uses a service-worker-mediated fake download response. Emulates a server streaming file download, no RAM buildup. Caveat: requires a MITM iframe on a separate origin to install the service worker (unless you self-host the MITM), and is flagged by its own author as "legacy-ish" now that FSA exists [StreamSaver legacy note](https://jimmywarting.github.io/StreamSaver.js/).
- Better option: [`file-system-access` ponyfill by use-strict](https://github.com/use-strict/file-system-access). FSA API with fallbacks. Active maintainer. TypeScript-native. Picks up StreamSaver's service-worker technique when needed.

**Recommended structure:**

```ts
async function saveDecryptedFile(ciphertextStream, key, filename) {
  let writable: WritableStream<Uint8Array>;

  if ('showSaveFilePicker' in window) {
    const handle = await window.showSaveFilePicker({ suggestedName: filename });
    writable = await handle.createWritable();
  } else {
    // Fallback: StreamSaver via file-system-access ponyfill
    const { createWritable } = await import('@/lib/download/streamsaver');
    writable = await createWritable(filename);
  }

  await ciphertextStream
    .pipeThrough(decryptChunksTransform(key))
    .pipeTo(writable);
}
```

**Caveat for your zero-knowledge model:** The service-worker approach in StreamSaver requires a same-origin MITM iframe or a self-hosted copy. If you self-host, that's fine. Do not load the upstream public MITM from `jimmywarting.github.io` — it breaks your CSP assumptions and adds a third-party dependency to your download flow.

---

## 8. Worker RPC — `comlink`

### Recommendation: Adopt `comlink` if you haven't already.

Your `use-files.ts` does chunked encrypt/upload/download on what I assume is the main thread. For anything over ~10 MB, this will jank the UI during the Argon2id unlock, during the XChaCha20 encrypt pass, and during HKDF/Ed25519 operations in tight loops.

**Recommended:** [`comlink`](https://github.com/GoogleChromeLabs/comlink) — 1.1 KB RPC layer over `postMessage` + ES6 Proxies. Google Chrome Labs project, actively maintained. Turns worker communication into `await worker.encrypt(chunk)` which is how your code wants to look.

**Structure:** Put your crypto module behind a worker. One worker per tab is usually enough. A worker *pool* (4x hardware concurrency) is overkill for upload pipelining — network is the bottleneck, not the cipher. [Jan Müller's 2025 worker comparison](https://janmueller.dev/blog/web-workers/) has a decent benchmark showing Comlink adds ~5% overhead over raw postMessage, which is fine.

**Alternatives:**
- `bidc` — slightly different serialization, allows sending functions, small following [same Jan Müller post].
- `comctx` — adapter-pattern Comlink alternative for iframe/extension communication [DEV.to article on Comctx](https://dev.to/molvqingtai/comctx-a-better-cross-context-communication-library-than-comlink-257l). Overkill for your use case.
- `kkRPC` — TypeScript-first RPC for worker + stdio + iframe + extension [DEV.to kkRPC article](https://dev.to/huakun/kkrpc-15m8). Cool but immature.

**Use comlink. It's the standard.**

**Action items:**
- Move Argon2id, XChaCha20 encrypt/decrypt, and HKDF into a `/crypto-worker.ts` and expose via Comlink.
- Move the chunked upload encrypt pass there as well — encrypt chunk N+1 while chunk N is in-flight to R2.
- Keep Ed25519 sign/verify in main thread (microsecond-scale, not worth the IPC).

---

## 9. File preview — keep your current architecture

### Recommendation: Keep. It's already ahead of most competitors.

The isolated viewer subdomain (`pdf.securewarp.com`) with per-type routes, postMessage transfer, strict CSP, sandboxed iframe, DOMPurify on mammoth, React-escaped exceljs, and zeroed plaintext is a production-grade preview pipeline. I have very few suggestions here beyond what's already in AGENTS.md:

- Consider splitting the viewer origin **per file** (e.g. `<fileId>.pdf.securewarp.com`) if you want cross-file isolation too. This protects against a malicious file exfiltrating another file's bytes if it somehow escapes the sandbox. Cost: wildcard DNS + wildcard cert. Benefit: marginal, but real.
- Replace `mammoth` with something less permissive when possible — mammoth supports a `raw` HTML mode that bypasses their own converters, and I'd audit the specific mode you're using. The DOMPurify pass covers it, but defense-in-depth is cheap here.
- Your xlsx renderer uses `exceljs`. Consider [`@zurmokeeper/exceljs`](https://www.npmjs.com/package/exceljs) (the maintained fork) if you haven't already — original `exceljs` has had intermittent maintenance issues.

---

## 10. Post-quantum — don't hybrid yet, but plan

### Recommendation: Leave ML-KEM out of v1. Revisit in 12–18 months.

Your earlier message mentioned ML-KEM-768. I strongly recommend *not* shipping it in the first production release, for three reasons:

1. **It's not on your wire today.** Your AGENTS.md doesn't reference ML-KEM anywhere. Adding it means new wrap format, migrations, ciphertext growth, and doubled share latency on every `file_keys` row creation.
2. **No competing E2E storage product ships PQ-hybrid yet.** Proton, Tresorit, Filen, Internxt — none of them. Signal has PQXDH for messaging only (ephemeral keys), which is a much smaller scope than "every shared file forever."
3. **`@noble/post-quantum` is unaudited.** Paul Miller's own docs say [Noble cryptography homepage](https://paulmillr.com/noble/) that hashes and curves are partially audited; post-quantum is not. Shipping unaudited PQ into a zero-knowledge product whose core value is cryptographic assurance is not the right bet for year one.

**What to do instead:**
- Design the `file_keys.encrypted_private_hierarchical_key` column so it's a versioned envelope (`v1:<x25519-wrap>` today, `v2:<x25519+mlkem768-hybrid-wrap>` later). This way you don't repaint everything when PQ lands.
- Track Proton's roadmap and the OpenPGP-WG's PQ draft. When Proton ships hybrid, you can ship 6–12 months later and not be the guinea pig.

---

## 11. Third-party security audit

### Recommendation: Budget for Cure53, Radically Open Security, or Trail of Bits once past MVP.

This is probably the single highest-leverage trust signal available to you as a solo indie. Bitwarden has a dedicated "audits and certifications" page with 8+ Cure53 reports [Bitwarden compliance page](https://bitwarden.com/help/is-bitwarden-audited/). Proton Drive publishes Securitum audits. NymVPN publishes Cure53 audits with full remediation status [NymVPN Cure53 audit page, 2024](https://nym.com/trust-center/Cure53-security-audit-2024). This is the bar for "take us seriously as an E2E product."

**Vendor options:**

- **Cure53** — Berlin. Strong on crypto and web apps. Audits Bitwarden, NordVPN, Obsidian, KeePassium, Nym. [Cure53 homepage](https://cure53.de/). Highly respected but expensive and limited availability [Cybri fintech pentest vendor comparison, 2025](https://cybri.com/blog/best-fintech-penetration-testing-companies/).
- **Trail of Bits** — NYC. Strong on cryptography engineering and formal methods. Heavy blockchain focus but does general crypto review [Trail of Bits audits blog](https://blog.trailofbits.com/categories/audits/).
- **Radically Open Security** — Dutch non-profit. Publishes full reports. More affordable for indie budgets.
- **Latacora** — often retained by YC startups, offers security-as-a-service models.

**Realistic timeline:** Cure53 engagements are typically 2–6 weeks of auditor time, $30k–$150k+ depending on scope. A *focused* crypto-only audit (SRP, hierarchical keys, rotation flows — not your React app) can be on the lower end. You'd hand them the `src/lib/crypto/**` and `src/lib/srp/**` trees plus your `AGENTS.md` invariants and let them go.

**Pre-audit checklist:**
- Your AGENTS.md is already doing a lot of the work an auditor usually has to do themselves (enumerate invariants, threat model, known limitations). This will reduce auditor hours.
- Ship Ed25519 signing *before* audit, not after. It's a known gap; paying someone $30k to tell you to add Ed25519 is a waste.
- Write the rotation tests (Phase 5 + 5.1) before audit. These are the highest-risk flows.

---

## 12. Observability & ops hygiene (not libraries, but load-bearing)

A few things that aren't library picks but matter for a zero-knowledge product:

- **Structured audit logging** — you already have `security_audit` and `admin_audit`. Keep them append-only and never log file/folder names (which you don't — invariant already holds).
- **Sentry is disabled on the viewer subdomain** — correct. For the main app, configure Sentry with `beforeSend` stripping every string that could contain secrets (request bodies, query params with tokens, etc.).
- **Dependency pinning** — your crypto dependency tree (`@noble/*`, `argon2-browser` or its replacement, `tssrp6a` if you switch) should be pinned at exact versions and have `npm audit` run in CI. Supply chain compromise of `@noble/ciphers` ends your product.
- **SRI for WASM** — consider hosting the Argon2 WASM blob from your origin with Subresource Integrity. If you CDN it, pin the hash.
- **Deterministic builds** — Proton publishes deterministic build hashes so users can verify the shipped JS matches open source. This is a future item for SecureWarp but worth having on the roadmap for the "paranoid user" segment that's your best word-of-mouth.

---

## Appendix A: What competitors use (for your sanity)

| Product | Symmetric AEAD | Asymmetric | Auth | Notes |
|---|---|---|---|---|
| Proton Drive | AES-256-GCM (per OpenPGP) + ChaCha20 in transit | Curve25519 (OpenPGP ECDH) | SRP | OpenPGP-based, dual ECC+RSA for legacy. [Proton Drive security page](https://proton.me/drive/security), [ETH Zürich thesis](https://ethz.ch/content/dam/ethz/special-interest/infk/inst-infsec/appliedcrypto/education/theses/lea-micheloud-master-thesis.pdf) |
| Tresorit | AES-256-GCM | RSA-4096 | Enterprise SSO / custom | Closed source; their whitepaper is light on primitive details |
| Filen | AES-256-GCM (CBC historically) | RSA-4096 (older), Ed25519+X25519 (newer) | PBKDF2-based (!) | AGPL, German. PBKDF2 is a clear downgrade vs. your Argon2id. [Filen whitepaper](https://cdn.filen.io/whitepaper.pdf), [Filen GitHub org](https://github.com/FilenCloudDienste) |
| Internxt | AES-256-CTR | ECIES | bcrypt | Spain-based, open source |
| MEGA | AES-128-CCM (historical), now AES-256 | RSA-2048 | Custom (has had published cryptanalytic issues) | Open source clients |
| **SecureWarp (you)** | **XChaCha20-Poly1305** | **X25519+HKDF+XChaCha20-Poly1305** | **SRP-6a** | Strongest modern primitive selection of the lot |

You are the only one shipping XChaCha20-Poly1305. This is not a disadvantage — it's better-argued on nonce safety than GCM, and it's interoperable via standard libraries. Just be prepared to explain it in your marketing copy ("Why we use XChaCha20-Poly1305").

---

## Appendix B: Decision log

Short rationale for the three places where I'm recommending you keep what's non-obvious:

**Kept XChaCha20-Poly1305 over AES-256-GCM (hardware accelerated):** AES-NI perf advantage is real but eaten by network I/O during upload, and the 192-bit nonce vs 96-bit nonce delta materially matters when you're generating millions of nonces across chunks and versions.

**Kept SRP-6a over OPAQUE:** OPAQUE is 9 months old as an RFC, Informational not Standards Track, and not deployed in any E2E storage product. Migrating to it today buys you risk, not security.

**Kept your current Skiff-style hierarchical keys over something simpler:** The O(1) folder-share property is genuinely valuable and nothing simpler gets you there without per-file fan-out on every share.

---

## Appendix C: Full source list

All sources cited inline above. Collected here for copy-paste:

- Proton Drive security model: https://proton.me/blog/protondrive-security and https://proton.me/drive/security
- Proton Key Transparency whitepaper: https://proton.me/files/proton_keytransparency_whitepaper.pdf
- ETH Zürich Proton Drive thesis (Backendal & Huigens): https://ethz.ch/content/dam/ethz/special-interest/infk/inst-infsec/appliedcrypto/education/theses/lea-micheloud-master-thesis.pdf
- Filen whitepaper: https://cdn.filen.io/whitepaper.pdf
- Filen GitHub: https://github.com/FilenCloudDienste
- Noble cryptography overview: https://paulmillr.com/noble/
- `@noble/ciphers` on npm: https://www.npmjs.com/package/@noble/ciphers
- `@noble/ciphers` on GitHub: https://github.com/paulmillr/noble-ciphers
- Nik Graf, "Noble vs Libsodium.js" (2024): https://www.nikgraf.com/blog/choosing-a-cryptography-library-in-javascript-noble-vs-libsodium-js
- `argon2-browser` (antelle): https://github.com/antelle/argon2-browser
- `@phi-ag/argon2`: https://github.com/phi-ag/argon2
- `hash-wasm`: https://github.com/Daninet/hash-wasm
- `tssrp6a`: https://github.com/midonet/tssrp6a
- `secure-remote-password` (LinusU): https://www.npmjs.com/package/secure-remote-password
- `scirexs/srp6a`: https://github.com/scirexs/srp6a
- `tus-js-client`: https://github.com/tus/tus-js-client
- `@tus/server` v2 announcement: https://tus.io/blog/2025/03/25/tus-node-server-v200
- tus FAQ and protocol spec: https://tus.io/faq and https://tus.io/protocols/resumable-upload
- Supabase resumable uploads: https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- Cloudflare Stream tus docs: https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/
- Cloudflare R2 upload docs: https://developers.cloudflare.com/r2/objects/upload-objects/
- Cloudflare R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Thinking Loop, "9 High-Scale File Upload Designs" (Medium, 2025): https://medium.com/@ThinkingLoop/9-high-scale-file-upload-designs-with-s3-r2-and-signed-urls-ad1425ee85e8
- MDN File System API: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
- Can I Use FSA: https://caniuse.com/native-filesystem-api
- LambdaTest FSA matrix: https://www.lambdatest.com/web-technologies/native-filesystem-api
- `StreamSaver.js`: https://github.com/jimmywarting/StreamSaver.js
- `file-system-access` ponyfill (use-strict): https://github.com/use-strict/file-system-access
- Comlink (Google Chrome Labs): https://github.com/GoogleChromeLabs/comlink
- Jan Müller, "Working wonders with web workers" (2025): https://janmueller.dev/blog/web-workers/
- Wikipedia, ChaCha20-Poly1305: https://en.wikipedia.org/wiki/ChaCha20-Poly1305
- Proton VPN, "What is ChaCha20?" (2025): https://protonvpn.com/blog/chacha20
- Libsodium XChaCha20-Poly1305 docs: https://libsodium.gitbook.io/doc/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction
- RFC 9807 (OPAQUE): https://www.rfc-editor.org/info/rfc9807
- NIST Crypto Reading Club talk on OPAQUE (Krawczyk, 2024): https://csrc.nist.gov/Presentations/2024/the-opaque-password-protocol
- Cure53: https://cure53.de/
- Bitwarden audits page: https://bitwarden.com/help/is-bitwarden-audited/
- NymVPN Cure53 audit: https://nym.com/trust-center/Cure53-security-audit-2024
- Trail of Bits audits blog: https://blog.trailofbits.com/categories/audits/

---

*Document ends.*
