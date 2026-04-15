# Security Policy

SecureWarp is a zero-knowledge encrypted drive. This document explains
how we handle security, what we defend against, and how to report a
vulnerability.

## Supported versions

SecureWarp ships as a single continuously-deployed web app at
securewarp.com. There are no versioned releases. Fixes land on `main`
and deploy from there. If you're reporting a vulnerability, we assume
you're testing the latest production deployment unless you say
otherwise.

## Reporting a vulnerability

**Please do not file public GitHub issues for security bugs.**

Email **security@securewarp.com** with:

- A clear description of the issue.
- Reproduction steps (PoC welcomed; short videos welcome for UI issues).
- Affected version / commit SHA if known.
- Your name / handle if you want credit.

We aim to:

- Acknowledge receipt within **2 business days**.
- Triage and classify within **5 business days**.
- Patch critical issues within **14 days** of triage.
- Credit reporters publicly in the CHANGELOG (with your consent).

If you don't hear back within those windows, follow up — we don't
want your report to land in a spam folder unnoticed.

## Safe harbour

Good-faith security research against SecureWarp is welcome. We will
not pursue legal action or law-enforcement referral against anyone
who:

- Tests against their own account (not other users' data).
- Does not access, download, or modify data they don't own.
- Does not degrade service for other users (no load testing, no
  sustained automated attacks).
- Gives us a reasonable window to respond before public disclosure
  (90 days from first contact is our default).

## Scope

**In scope:**

- `securewarp.com` and subdomains (app, marketing).
- Our auth, sharing, and encryption flows.
- Our API endpoints under `/api/*`.
- Our client-side crypto implementations (SRP, Argon2id, hierarchical
  keys, link sharing, rotation).

**Out of scope** (report upstream, not to us):

- Issues in third-party dependencies where we're on the current
  version. (If we're on an outdated one, that's in scope.)
- Cloudflare / Supabase / R2 platform issues.
- Rate limiting that's working as designed (e.g. registration and
  login are rate-limited by IP; this is intentional).
- Self-XSS requiring attacker to already have the victim's password.
- Social-engineering attacks against our operators.

## Threat model — what we defend against

SecureWarp is designed around the assumption that **the server is
hostile or compromised**. Concretely:

- **Server operators** (including us) cannot read your file content,
  file names, folder names, or derive your password.
- **Database breach** — even with full database access plus R2 access,
  an attacker sees only ciphertext, the SRP verifier (Argon2id-wrapped),
  public keys, and metadata that's inherently server-side (email,
  timestamps, storage quotas).
- **TLS interception / active MITM** against the transport — the SRP
  handshake means your password is never sent over the wire; an
  attacker who decrypts TLS sees the SRP verifier but not the password.
- **Malicious file uploads** — uploaded content never executes on the
  server (we just store ciphertext) and never renders as same-origin
  HTML in another user's browser. See `AGENTS.md` → "File-preview
  safety" for the allowlist.

## Threat model — what we do NOT defend against

Be clear-eyed about this. Zero knowledge has limits.

- **Malware on your device.** If your browser or OS is compromised,
  anything your browser sees (including your password during login
  and your decrypted files) is exposed. We cannot protect you from
  yourself here.
- **Password guessing offline** after an attacker obtains the
  Argon2id-wrapped SRP verifier. Use a strong, unique password. We
  use Argon2id with tuned parameters to slow this down, but weak
  passwords are breakable regardless.
- **Recovery-key loss.** If you forget your password AND lose your
  recovery phrase, your data is unrecoverable. We do not and cannot
  reset accounts — there is no master key.
- **Metadata.** The server sees: your email, when you logged in,
  which IPs accessed your account, file sizes, upload timestamps,
  who you've shared files with, who's in your workspace. The bodies
  and names are encrypted; the relationships and traffic patterns
  aren't.
- **Collaborator leak.** Anyone you share a file or folder with can
  decrypt that file forever, including to a copy they cached. We
  support rotation on revoke (Phase 5) but can't un-decrypt a file
  someone already downloaded.
- **Link-share recipients.** Anyone with a public share link can
  decrypt that file. Password-protected links (Phase 4.1) raise the
  bar but the password is the only gate.
- **Physical access to an unlocked device.** The decrypted keys live
  in `sessionStorage` per tab and in a password-encrypted
  `localStorage` cache for tab-reopen convenience. Both are readable
  by other code running in your browser session.

## Our defences

The short list, with where it lives in code:

- **Client-side encryption** — `src/lib/crypto/**`, `src/lib/srp/**`.
- **Zero-knowledge auth** — SRP-6a; password never sent to server.
- **Hierarchical keys** — `src/lib/crypto/hierarchical.ts` and test
  file; per-file keypair, folder inheritance via wrapped claims.
- **Forward secrecy on revoke** — Phase 5 rotation. See AGENTS.md
  invariants 14 and 15.
- **Rate limiting** — `src/lib/auth/rate-limit.ts`, fail-closed.
- **Strict HTTP security headers** — `next.config.ts`. CSP,
  HSTS + preload, COOP/CORP, Permissions-Policy, frame-ancestors
  none, nosniff.
- **File-preview allowlist** — `src/lib/mime-safety.ts`. Preview
  pipeline coerces unknown/dangerous MIMEs to `application/octet-stream`
  so uploaded HTML can't render as same-origin code, and never puts
  `text/html` on a Blob's declared type. SVGs render via `<img src>`
  only — browsers block embedded scripts and external fetches when
  SVG is loaded that way.
- **Isolated viewer subdomain** — PDFs (`/viewer`), Word docs
  (`/viewer/docx`), and Excel sheets (`/viewer/xlsx`) all render at
  a dedicated origin (`pdf.securewarp.com`) in an iframe the main
  app embeds. The main app decrypts client-side and postMessages
  the raw bytes to the viewer; each viewer route runs its renderer
  (PDFium/PDF.js, mammoth, exceljs) entirely in the browser. A
  malicious file that exploits a renderer is contained to an origin
  with no cookies, no storage, no API routes, and a CSP whose
  `connect-src` is `'self'` only — there is nowhere to exfiltrate
  to. Sentry is disabled on this origin so the tunnel route can't
  be abused. The parent's iframe carries
  `sandbox="allow-scripts allow-same-origin"` for browser-enforced
  defense in depth (no popups, no top-level navigation, no
  downloads, no form submission). Mammoth output is sanitized with
  DOMPurify before injection; exceljs output is rendered through
  React (escaped). Plaintext bytes are zeroed on both sides after
  transfer.
- **Admin audit log** — every privileged admin action appended to
  `admin_audit` forever, separate from security_audit.
- **Turnstile** — optional bot-gate on auth routes; on when
  `TURNSTILE_SECRET_KEY` is set.
- **Email hygiene** — outbound email never contains plaintext file
  names or any encrypted-metadata-derived field.

## What's coming

Tracked separately, but worth naming:

- Nonce-based CSP to remove `'unsafe-inline'` from `script-src`.
  `'unsafe-eval'` has already been dropped in favor of the narrower
  `'wasm-unsafe-eval'` required by the WASM Argon2id implementation.
- Third-party security review.

## Contact

- Vulnerability reports: **security@securewarp.com**
- General questions: **hello@securewarp.com**
