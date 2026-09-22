/**
 * Maintenance mode — a site-wide switch that closes the app to
 * everyone: landing page, signup, login, drive, share links, admin,
 * and every API route. Existing sessions are shut out too; this is a
 * "site is closed" switch, not a "no new signups" flag (that one is
 * `signups_enabled` in `src/lib/flags.ts`).
 *
 * Toggled by the `MAINTENANCE_MODE` Worker secret, deliberately NOT
 * by a row in `app_settings`:
 *   - It must keep working when Supabase is unreachable or paused
 *     (the free tier auto-pauses an idle project — exactly the state
 *     a closed site drifts into). A DB-backed switch would have to
 *     pick between failing open into a broken app or failing closed
 *     on every DB blip.
 *   - The admin UI at /admin/flags sits behind the switch, so it
 *     couldn't be used to turn the switch back off.
 *   - A secret, unlike a `vars` entry in wrangler.jsonc, survives
 *     `wrangler deploy`, so shipping code while closed doesn't
 *     silently reopen the site.
 *
 * Enforced in `src/middleware.ts`. This module stays free of
 * `server-only` and Node APIs so the middleware (edge) and the
 * client-side version poller can both import from it.
 */

/** Response header the client uses to tell "closed" from "broken". */
export const MAINTENANCE_HEADER = "x-securewarp-maintenance";

const ON_VALUES = new Set(["1", "true", "on", "yes"]);

export function isMaintenanceEnabled(value: string | undefined): boolean {
  if (!value) return false;
  return ON_VALUES.has(value.trim().toLowerCase());
}

/**
 * Server-to-server routes that must keep working while the site is
 * closed. Each is authenticated by its own secret, not a user session.
 *   - Stripe webhook: subscriptions still renew and cancel while we're
 *     closed; dropped deliveries leave billing state out of sync once
 *     Stripe gives up retrying.
 *   - Cron + stale-upload cleanup: housekeeping (trash expiry, version
 *     pruning, status checks) that should not pile up behind the switch.
 */
const EXEMPT_PATHS = [
  "/api/billing/webhook",
  "/api/cron",
  "/api/admin/cleanup-stale",
];

export function isMaintenanceExempt(pathname: string): boolean {
  return EXEMPT_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const RETRY_AFTER_SECONDS = "3600";
const DEFAULT_SUPPORT_EMAIL = "hello@securewarp.com";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 503 for a request that arrived while the site is closed. API paths
 * get JSON so fetch callers can branch on it; everything else gets a
 * self-contained HTML page. The page doesn't go through the Next.js
 * renderer, so it can't pull in layout code that calls an API that's
 * also closed, and it renders the same whether or not the DB is up.
 */
export function maintenanceResponse(pathname: string, supportEmail?: string): Response {
  const headers = new Headers({
    "Retry-After": RETRY_AFTER_SECONDS,
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
    [MAINTENANCE_HEADER]: "1",
  });

  if (pathname.startsWith("/api/")) {
    headers.set("Content-Type", "application/json");
    return new Response(
      JSON.stringify({ error: "SecureWarp is temporarily down for maintenance.", code: "maintenance" }),
      { status: 503, headers },
    );
  }

  headers.set("Content-Type", "text/html; charset=utf-8");
  // No scripts on this page, so none are allowed. The font is the
  // self-hosted Chillax file from public/ (excluded from the
  // middleware matcher, so it's served even while closed).
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  return new Response(maintenanceHtml(supportEmail || DEFAULT_SUPPORT_EMAIL), { status: 503, headers });
}

// Colours and fonts mirror the brand constants in
// src/components/marketing-shell.tsx. Dark mode follows the OS
// setting: there's no JS here to read the app's saved theme.
function maintenanceHtml(supportEmail: string): string {
  const email = escapeHtml(supportEmail);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Down for maintenance | Securewarp</title>
<link rel="icon" href="/icon.svg?v=2" type="image/svg+xml">
<style>
@font-face{font-family:"Chillax";src:url("/fonts/Chillax-Variable.woff2") format("woff2");font-weight:200 700;font-display:swap}
:root{--bg:#faf8f4;--text:#0a0a0a;--muted:rgba(0,0,0,.55);--border:rgba(0,0,0,.08);--accent:rgb(239,90,60);--sans:"Chillax",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0b;--text:#f4f2ee;--muted:rgba(255,255,255,.6);--border:rgba(255,255,255,.1)}}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--text);font-family:var(--sans);-webkit-font-smoothing:antialiased;display:flex;flex-direction:column}
header{padding:20px 32px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:13px;font-weight:600;letter-spacing:.18em}
main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:96px 32px}
.eyebrow{margin:0 0 24px;font-family:var(--mono);font-size:12px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);display:inline-flex;align-items:center;gap:10px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--accent)}
h1{margin:0 0 16px;font-size:clamp(2rem,5vw,3.25rem);line-height:1.08;font-weight:400;letter-spacing:-.03em}
h1 span{color:var(--accent)}
p{margin:0 auto;max-width:520px;font-size:16px;line-height:1.6;color:var(--muted);text-wrap:pretty}
.contact{margin-top:32px;font-size:14px}
a{color:var(--text);text-decoration:underline;text-decoration-color:var(--accent);text-underline-offset:3px}
</style>
</head>
<body>
<header>SECUREWARP</header>
<main>
<p class="eyebrow"><span class="dot" aria-hidden="true"></span>Down for maintenance</p>
<h1>We&rsquo;ll be <span>right back</span>.</h1>
<p>Securewarp is offline while we make some improvements. Sign-in and sign-up are paused until we reopen. Your encrypted files are untouched while we work.</p>
<p class="contact">Questions? Email <a href="mailto:${email}">${email}</a></p>
</main>
</body>
</html>`;
}
