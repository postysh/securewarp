# Admin Dashboard — Roadmap

Scope tracker for the `/admin` surface. Grouped by "when it becomes necessary"
rather than by category, so it doubles as a checklist. Update the boxes as
items ship.

## Guardrails

SecureWarp is zero-knowledge. The admin dashboard must never break that.
Things the server literally cannot see — file content, filenames, user
passwords, encryption keys — stay invisible in admin tools forever.
Metadata the server already knows (email, sizes, timestamps, audit events,
session info) is fair game.

---

## ✅ Already shipped

- [x] `users.role` column (`user` | `admin` | `owner`) gating `/admin/*`
- [x] `users.suspended_at` with instant session revocation on suspend
- [x] `users.last_login_at` stamped on successful login
- [x] `admin_audit` table — separate append-only trail for admin actions
- [x] `requireAdmin()` helper + per-route server-side role check
- [x] `/admin` — Overview with users, active-7d, new, suspended, files,
      storage + 14-day signup histogram + recent signups / admin actions
- [x] `/admin/users` — paginated, searchable list with file-browser row
      layout (colored avatar, role pill, storage, files, last login,
      joined calendar date, hover actions)
- [x] `/admin/audit` — unified security + admin events with actor→target
      chips and kind stripe
- [x] Per-row actions: Suspend (with reason), Unsuspend, Promote/Demote
      (owner-only), Delete account (owner-only, email-confirm)
- [x] `/api/admin/stats`, `/overview`, `/users`, `/users/[id]/{suspend,unsuspend,role,delete}`, `/audit`, `/me`

---

## 🎯 Now — before 50 users (building this cut)

- [ ] **User detail page** (`/admin/users/[id]`). Click any user from the
      list → drill into a single-user view: profile header, active
      sessions (with IP/UA) + revoke, per-user audit trail, storage
      breakdown, admin notes. Replaces most of the "let me run SQL"
      support loop.
- [ ] **Per-user admin notes** (`admin_notes` table). Owner/admin can
      leave context for each user: "spoke w/ user re: X on date". Notes
      are admin-visible only, never surfaced to the user.
- [ ] **System health strip on Overview.** Status pills for Supabase,
      R2, last cleanup-cron success, last trash-expire-cron success,
      recent error count. One glance to see "is anything broken?"
- [ ] **User lookup from Overview.** Search box at the top of Overview
      that jumps to `/admin/users/[id]` directly for the matched user.
      (Bonus on top of the existing `/admin/users` search.)

---

## 🟡 Soon — 50 to 500 users

- [ ] **Abuse signals panel.** Heuristic flags, zero-knowledge safe:
  - Storage growth > 10× normal in a day
  - > 50 public links created in 24h (phishing campaign signal)
  - Failed-login rate > 20/hour on one email
  - Mass-delete operations (account compromise signal)
- [ ] **Announcements banner.** `announcements` table + admin UI to
      publish. Renders a dismissible strip at the top of `/drive` for
      all logged-in users. "Scheduled maintenance tonight" / "New
      feature" etc.
- [ ] **Feature flags.** `app_settings` table with booleans like
      `signups_enabled`, `uploads_enabled`, `invite_only_mode`. Toggle
      from admin UI without a deploy. Critical for incident response.
- [ ] **Per-user quota overrides.** `users.storage_quota_bytes` column,
      nullable. Admin can bump a specific user's quota without changing
      their plan.
- [ ] **Orphan-upload view.** Count of stale incomplete uploads awaiting
      the cleanup cron. Useful for "is R2 broken?" diagnosis.
- [ ] **Per-user session list + revoke.** In user detail, list all
      active `sessions` rows with timestamps. One-click revoke for "user
      had their laptop stolen" scenarios.
- [ ] **Link analytics per user.** Count of active public links per
      user, with a cap warning. (Spot single users abusing the link
      feature.)

---

## 💰 When monetization lands

- [ ] **Plans + billing dashboard** (Stripe-backed). MRR chart, active
      subs, churn, failed payments, refund queue.
- [ ] **Per-user plan assignment + trial status.**
- [ ] **Usage-based cost view.** R2 storage above quota, chunk-upload
      volume — directly maps to R2 line items in Cloudflare billing.
- [ ] **Referral / invite tracking** if invites become a growth lever.

---

## ⚖️ Legal / compliance (when you have paying users or legal attention)

- [ ] **GDPR data-export.** Button in user detail: emit all
      non-encrypted metadata about a user as JSON. Covers account info
      + audit trail + file metadata (sizes, dates — NOT content/names,
      which are end-to-end encrypted anyway).
- [ ] **Law enforcement request log.** Immutable table of every
      subpoena / legal request received, what was provided, by whom.
      Feeds a future transparency report.
- [ ] **Retention policy controls.** "Hard-delete N days after account
      closure." Configurable per-plan.
- [ ] **Privacy policy version tracking.** Record which TOS version
      each user accepted at signup, and prompt on new versions.

---

## 🚫 Won't build — zero-knowledge by design

These requirements may come from instinct or non-technical stakeholders.
They cannot ship without breaking the core product promise. Push back
every time.

- **Viewing file content or filenames** — encrypted client-side; server
  never sees them. Not a limitation to work around, it's the product.
- **"Login as user" / impersonation** — would require keys the server
  doesn't hold. Tell users this is a *feature* of the product.
- **Server-side password reset** — user keys derive from password.
  Lost password = recovery key flow only. Admin cannot reset.
- **Traditional content moderation / CSAM hash matching** — ciphertext
  is random; no perceptual hash match possible. Mitigations that DON'T
  break zero-knowledge:
  - Client-side reports on public links (`/share/[id]` report button)
  - Abuse-signal heuristics on metadata (storage growth, link volume)
  - Tight terms of service + rapid ban pipeline
