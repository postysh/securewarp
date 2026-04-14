import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// ──────────────────────────────────────────────────────────────────────
// HTTP security headers
// ──────────────────────────────────────────────────────────────────────
//
// Sent on every response. These supplement Cloudflare's edge protection
// (WAF, DDoS, Bot Fight) with browser-side defences that Cloudflare
// can't do for us: content-sniffing, clickjacking, referrer leakage,
// clipboard/geolocation/camera API abuse, cross-origin window popups,
// and — most importantly — Content-Security-Policy.
//
// CSP notes:
//   - `default-src 'self'` means scripts, styles, images, fonts, etc.
//     must come from the same origin unless explicitly allowlisted.
//   - `'unsafe-inline'` is allowed on style-src because tailwind and
//     Next.js hydration emit inline styles. We accept that risk because
//     CSS injection doesn't execute JS.
//   - `script-src 'self' 'unsafe-inline' 'unsafe-eval'` is the reality
//     for Next.js dev mode (it uses eval-based HMR) and for inline
//     hydration bootstraps in prod. Production could tighten to strict
//     nonces, but Next.js 16 doesn't expose a nonce injection API yet
//     without opting into experimental features.
//   - `connect-src` covers fetch/XHR targets. We allow self + R2 + the
//     Cloudflare challenge endpoint for Turnstile. Anything else is
//     blocked, which means a compromised dep can't exfiltrate data.
//   - `img-src data:` because blob URLs for decrypted content use the
//     data: scheme briefly during download materialization.
//   - `frame-ancestors 'none'` is a CSP equivalent of X-Frame-Options.
//     Browsers respect both; having both is belt+suspenders.
const connectSources = [
  "'self'",
  // R2 endpoints for direct presigned PUT/GET. Use a wildcard on the
  // r2.cloudflarestorage.com host so both the account-specific endpoint
  // and any R2 region subdomain work.
  "https://*.r2.cloudflarestorage.com",
  // Turnstile widget calls this endpoint when rendered.
  "https://challenges.cloudflare.com",
  // Supabase REST + realtime, in case any client-side direct fetches
  // are added later (today the service-role client is server-only).
  "https://*.supabase.co",
  "wss://*.supabase.co",
  // Cloudflare Web Analytics beacon data endpoint.
  "https://cloudflareinsights.com",
  // Sentry error reporting.
  "https://*.ingest.us.sentry.io",
];

const scriptSources = [
  "'self'",
  // Turnstile's embed script lives on this origin.
  "https://challenges.cloudflare.com",
  // Cloudflare Web Analytics beacon, auto-injected by the proxy.
  "https://static.cloudflareinsights.com",
  // Required for Next.js hydration inline bootstrap.
  "'unsafe-inline'",
  // Required for Next.js dev HMR. Kept in prod because removing it
  // triggers CSP violations on certain Next internals; revisit if
  // Next ships a nonce-based alternative.
  "'unsafe-eval'",
];

const frameSources = [
  "'self'",
  // Turnstile renders in an iframe.
  "https://challenges.cloudflare.com",
  // PDF preview renders decrypted content in blob: iframes.
  "blob:",
];

const csp = [
  `default-src 'self'`,
  `script-src ${scriptSources.join(" ")}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:`,
  `media-src 'self' blob:`,
  `font-src 'self' data:`,
  `connect-src ${connectSources.join(" ")}`,
  `frame-src ${frameSources.join(" ")}`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `worker-src 'self' blob:`,
  `object-src 'none'`,
  `upgrade-insecure-requests`,
].join("; ");

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    // 2-year max-age with preload eligibility. Only set in production
    // builds to avoid breaking local http:// dev.
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Disable browser APIs we don't use. Notable: no camera, mic,
    // geolocation, usb, serial, interest-cohort (FLoC/Topics).
    value:
      "camera=(), microphone=(), geolocation=(), usb=(), serial=(), payment=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // COOP isolates the browsing context so cross-origin popups can't
  // access our window. Combined with frame-ancestors 'none' this gives
  // us Spectre-class isolation for free.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    // Local dev runs over http://localhost:3000 and the security
    // headers above would break it:
    //   - `upgrade-insecure-requests` silently rewrites same-origin
    //     fetches to https://localhost, which the dev server can't
    //     answer → scripts/styles/HMR all 404.
    //   - 2-year HSTS caches against `localhost` so subsequent visits
    //     are forced to https://, same failure mode permanently until
    //     the user manually clears the HSTS entry.
    //   - A strict `connect-src` doesn't include `ws://localhost:*`,
    //     so Turbopack's HMR websocket is blocked.
    // Dev mode runs on localhost with no third-party scripts loaded
    // from the internet, so the protections are moot locally anyway.
    // Ship the full suite on production deployments (Vercel sets
    // NODE_ENV=production for every build) and nothing in dev.
    if (process.env.NODE_ENV !== "production") {
      return [];
    }
    return [
      {
        // Apply on every route. The Turnstile / R2 / Supabase allowances
        // are wide enough that we don't need per-path relaxations.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "securewarp",
  project: "securewarp",
  silent: !process.env.CI,
  tunnelRoute: "/sentry-tunnel",
});
