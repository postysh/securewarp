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

**Foundation**
- [x] `users.role` column (`user` | `admin` | `owner`) gating `/admin/*`
- [x] `users.suspended_at` with instant session revocation on suspend
- [x] `users.last_login_at` stamped on successful login
- [x] `admin_audit` table — separate append-only trail for admin actions
- [x] `admin_notes` table — per-user admin-only notes, 2k-char cap
- [x] `requireAdmin()` helper + per-route server-side role check
- [x] Suspension block at login + recovery (returns 403 with reason;
      client renders a dedicated suspension notice replacing the login
      form; recovery bypass closed)
- [x] Cron heartbeats via awaited `auditEventAwait` (durable on Workers)

**Shell**
- [x] Admin layout mirrors drive shell — `bg-bg-side` outer, rounded
      floating card, collapsible 195/52px sidebar with persist
- [x] Sidebar: Overview / Users / Audit log + back-to-drive next to user
      menu; theme toggle + sign-out in user menu
- [x] Sidebar toggle button in each page's header bar
- [x] Full-width layouts (no centered rails) on all admin pages

**Pages**
- [x] `/admin` — Overview. Stat row (6 cards: Total / Active-7d /
      New-30d / Suspended / Files / Storage), 14-day signup histogram
      with 7d+30d totals, recent signups panel, recent admin actions
      panel, user lookup typeahead, system health strip (Supabase,
      R2, cleanup cron, trash cron with 36h freshness)
- [x] `/admin/users` — paginated, searchable, file-browser row layout
      (colored avatar, role pill, storage, files, last login, joined
      calendar date, hover action menu, whole row Link-to-detail)
- [x] `/admin/users/[id]` — full-width user detail. Profile header with
      inline actions, 3-col grid: Notes + Recent activity on the left
      (2/3), sticky Storage + Active sessions sidebar on the right.
      Admin notes (add / delete by author-or-owner), per-session jti
      revoke, per-user audit feed
- [x] `/admin/announcements` — card grid with status (Draft / Live /
      Expired), severity pill, inline edit / publish-toggle / delete.
      Editor modal with title, body, severity, optional datetime-local
      expiry. Save as draft or publish directly.
- [x] `/admin/audit` — unified security + admin events, filterable by
      source + free-text, actor→target chips, kind stripe

**Announcements banner (user side)**
- [x] `announcements` + `announcement_dismissals` tables. Severity
      info/warning/critical, optional expiry.
- [x] `<AnnouncementBanner>` rendered at the top of the drive shell.
      Severity-colored strip, dismiss ✕ persists server-side so it
      doesn't reappear on other devices.
- [x] `GET /api/announcements/active` + `POST /api/announcements/[id]/dismiss`

**Per-row actions (users list + detail page)**
- [x] Suspend (with user-facing reason, labeled "shown to the user")
- [x] Unsuspend
- [x] Promote / Demote role (owner-only)
- [x] Delete account (owner-only, email-typing confirmation, wipes R2)
- [x] Revoke individual session (detail page)

**API surface**
- [x] `/api/admin/me` — role check for layout gate
- [x] `/api/admin/stats` — Overview aggregate counters
- [x] `/api/admin/overview` — latest signups, latest admin actions,
      14-day signup histogram
- [x] `/api/admin/health` — Supabase ping, R2 config check, last cron
      heartbeat timestamps
- [x] `/api/admin/users` — paginated + searchable list
- [x] `/api/admin/users/[id]` — profile + usage + sessions + audit +
      notes in one response
- [x] `/api/admin/users/[id]/{suspend,unsuspend,role,delete}`
- [x] `/api/admin/users/[id]/notes` (GET/POST) +
      `/notes/[noteId]` (DELETE)
- [x] `/api/admin/users/[id]/sessions/[jti]` (DELETE)
- [x] `/api/admin/audit` — merged security + admin events with actor +
      target email hydration

---

## 🟡 Soon — 50 to 500 users

- [ ] **Abuse signals panel.** Heuristic flags, zero-knowledge safe:
  - Storage growth > 10× normal in a day
  - > 50 public links created in 24h (phishing campaign signal)
  - Failed-login rate > 20/hour on one email
  - Mass-delete operations (account compromise signal)
- [ ] **Feature flags.** `app_settings` table with booleans like
      `signups_enabled`, `uploads_enabled`, `invite_only_mode`. Toggle
      from admin UI without a deploy. Critical for incident response.
- [ ] **Per-user quota overrides.** `users.storage_quota_bytes` column,
      nullable. Admin can bump a specific user's quota without changing
      their plan.
- [ ] **Orphan-upload view.** Count of stale incomplete uploads awaiting
      the cleanup cron. Useful for "is R2 broken?" diagnosis.
- [ ] **Link analytics per user.** Count of active public links per
      user, with a cap warning. (Spot single users abusing the link
      feature.)
- [ ] **Admin audit subtab on detail page.** Right now the per-user
      "Recent activity" view shows security_audit only. Consider adding
      an admin_audit lane so you can see "admins took these actions on
      this user" in the same timeline.
- [ ] **Session IP/UA.** `sessions` table currently only stores jti +
      expires_at. Populate on login with request IP + User-Agent so the
      revoke UI can say *which* device it's revoking.

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
