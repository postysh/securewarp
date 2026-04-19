import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────────────
// Wrangler `vars` → Next build-time env inlining
// ──────────────────────────────────────────────────────────────────────
// Cloudflare splits config into two stores: wrangler.jsonc `vars` (runtime
// bindings the Worker sees at request time) and Builds dashboard vars
// (exposed to `next build` as process.env). `NEXT_PUBLIC_*` must be baked
// into the client bundle at build time, so keeping the value only in
// wrangler.jsonc leaves it undefined during `next build` and the key
// never reaches the browser. Read wrangler.jsonc here, extract every
// `NEXT_PUBLIC_*` entry from `vars`, and inject into Next's `env` block
// so the single source of truth is this file — no dashboard duplication.
// Required NEXT_PUBLIC_* vars the app cannot boot without. Missing any
// of these in a production build is a loud failure, not a silent ship:
// - STRIPE_PUBLISHABLE_KEY: empty → loadStripe(undefined) → useStripe()
//   null forever → Subscribe button permanently disabled (caught this
//   exact regression twice on the Cloudflare Workers Builds CI before
//   the assertion went in).
// - PDF_VIEWER_ORIGIN: empty → main app falls back to the inline blob
//   iframe path. Not broken, but silently loses the security isolation
//   the subdomain provides. Fail loudly so a botched deploy never quietly
//   drops defense-in-depth.
const REQUIRED_PUBLIC_VARS = [
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_PDF_VIEWER_ORIGIN",
];

function readWranglerPublicVars(): Record<string, string> {
  let out: Record<string, string> = {};
  try {
    const raw = readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8");
    // Strip // and /* */ comments and trailing commas so JSON.parse
    // accepts JSONC. Crude but sufficient for our config file — no
    // strings contain `//` today.
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    const parsed = JSON.parse(stripped) as { vars?: Record<string, unknown> };
    const vars = parsed.vars ?? {};
    out = {};
    for (const [k, v] of Object.entries(vars)) {
      if (k.startsWith("NEXT_PUBLIC_") && typeof v === "string") out[k] = v;
    }
  } catch {
    out = {};
  }

  // Fold in any NEXT_PUBLIC_* that are set directly on process.env so
  // `next dev` + Cloudflare Builds dashboard vars still work. Existing
  // wrangler.jsonc entries win on conflict — the file is the source of
  // truth.
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("NEXT_PUBLIC_") && typeof v === "string" && !(k in out)) {
      out[k] = v;
    }
  }

  // Production build gate. Empty values at build time = broken client
  // bundle at runtime. Fail the CI build loudly instead of shipping a
  // silently-broken deploy.
  if (process.env.NODE_ENV === "production") {
    const missing = REQUIRED_PUBLIC_VARS.filter((k) => !out[k] || out[k].length === 0);
    if (missing.length > 0) {
      throw new Error(
        `next.config.ts: required NEXT_PUBLIC_* vars are empty at build time: ${missing.join(", ")}. ` +
        `Set them in wrangler.jsonc \`vars\` (preferred) or as Cloudflare Builds env vars. ` +
        `Without these, the client bundle ships broken — see the "Stripe.js empty key" incident.`
      );
    }
  }

  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Build version string — exposed to the client as
// `process.env.NEXT_PUBLIC_BUILD_VERSION`. Rendered in the footer as
// `YYYY.MM.DD · <short-sha>` so every deploy is visually traceable.
// Git is resolved at build time (this file runs in Node); if the git
// command fails (shallow clone, git missing, CI image without .git)
// we fall back to a dev / unknown marker instead of breaking the
// build.
// ──────────────────────────────────────────────────────────────────────
function getBuildVersion(): string {
  const dateLabel = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, ".");
  try {
    const sha = execSync("git rev-parse --short HEAD", {
      stdio: ["pipe", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (!sha) throw new Error("empty sha");
    return `${dateLabel} · ${sha}`;
  } catch {
    return process.env.NODE_ENV === "production"
      ? `${dateLabel} · unknown`
      : `${dateLabel} · dev`;
  }
}

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
  // Decrypted preview content lives in same-origin blob: URLs. The PDF
  // preview path does `fetch(blobUrl)` to read raw bytes for transfer
  // to the isolated viewer iframe via postMessage. `'self'` doesn't
  // cover the blob: scheme, so list it explicitly.
  "blob:",
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
  // Stripe API + merchant UI endpoints used by the Payment Element.
  "https://api.stripe.com",
  "https://merchant-ui-api.stripe.com",
];

const scriptSources = [
  "'self'",
  // Turnstile's embed script lives on this origin.
  "https://challenges.cloudflare.com",
  // Cloudflare Web Analytics beacon, auto-injected by the proxy.
  "https://static.cloudflareinsights.com",
  // Stripe.js + Payment Element bootstrap script.
  "https://js.stripe.com",
  // Required for Next.js hydration inline bootstrap. Moving to a
  // nonce-based scheme is tracked as a separate hardening task —
  // see SECURITY.md "What's coming".
  "'unsafe-inline'",
  // `'wasm-unsafe-eval'` is the narrow CSP3 grant that covers
  // WebAssembly.instantiate() without re-enabling string-to-code
  // eval() / new Function(). argon2-browser ships a WASM module
  // for Argon2id key derivation and needs this; Next.js production
  // bundles don't use eval(), so we drop `'unsafe-eval'` entirely.
  "'wasm-unsafe-eval'",
];

const frameSources = [
  "'self'",
  // Turnstile renders in an iframe.
  "https://challenges.cloudflare.com",
  // PDF preview renders decrypted content in blob: iframes.
  "blob:",
  // Isolated PDF viewer subdomain (Phase 2 of PDF hardening). Only
  // applies when NEXT_PUBLIC_PDF_VIEWER_ORIGIN is set at build time
  // and DNS is pointed at this Worker; before that, PDF preview
  // uses the inline blob-iframe path and this entry is harmless.
  "https://pdf.securewarp.com",
  // Stripe's Payment Element and 3DS challenge iframes.
  "https://js.stripe.com",
  "https://hooks.stripe.com",
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
  // `'self'` (rather than `'none'`) so the main app can iframe its
  // own same-origin blob URLs when the isolated PDF viewer subdomain
  // isn't available and we fall back to the inline blob iframe. No
  // cross-origin clickjacking is enabled by this — only our own
  // origin can embed us, which is equivalent to
  // `X-Frame-Options: SAMEORIGIN` (which we also send as defense in
  // depth).
  `frame-ancestors 'self'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `worker-src 'self' blob:`,
  `object-src 'none'`,
  `upgrade-insecure-requests`,
].join("; ");

// ──────────────────────────────────────────────────────────────────────
// Isolated PDF viewer subdomain
// ──────────────────────────────────────────────────────────────────────
//
// Served at /viewer on a separate subdomain (e.g. pdf.securewarp.com).
// The main app embeds it as an iframe and postMessages the decrypted
// PDF bytes over. The subdomain has its own origin, so a PDF-viewer
// exploit runs isolated from the main app's cookies and storage.
//
// CSP differences from the main app:
//   - `frame-ancestors` includes the main app so iframe embedding is
//     allowed; we keep `'none'` for every other host.
//   - `connect-src` is `'self'` only. The viewer doesn't talk to any
//     third parties; even Sentry and analytics are intentionally
//     absent here so a compromised PDF viewer can't phone home.
//   - `object-src 'none'` and `form-action 'none'` tighten further.
//   - `default-src 'none'` is the baseline; we only open specific
//     directives (script, style, img, blob for the inline PDF).
//
// Headers NOT applied on the viewer (vs. main app):
//   - `X-Frame-Options: DENY` — omitted so the main app can embed.
//     `frame-ancestors` is the CSP equivalent and is strict enough.
//   - `Cross-Origin-Resource-Policy: same-origin` — overridden to
//     `cross-origin` so the main app can render the iframe.
const viewerScriptSources = [
  "'self'",
  // Next.js hydration inline bootstrap. Same caveat as the main app;
  // nonce-based CSP will drop this eventually.
  "'unsafe-inline'",
  // argon2 isn't used on this page, but keeping the narrow WASM
  // grant in place means future code that might need it doesn't
  // silently fail.
  "'wasm-unsafe-eval'",
  // Cloudflare Web Analytics beacon. Auto-injected by the CF proxy on
  // every HTML response in this zone — we can't strip it per-page from
  // the Worker. Allowed here only to silence the otherwise-blocked
  // injection. Sentry stays disabled on this origin (see
  // instrumentation-client.ts) so the viewer's exfil surface remains
  // limited to this single first-party CF endpoint.
  "https://static.cloudflareinsights.com",
];

const viewerCsp = [
  "default-src 'none'",
  `script-src ${viewerScriptSources.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  // blob: is how the viewer renders the received PDF bytes.
  "img-src 'self' blob: data:",
  // 'self' covers same-origin XHR/fetch; cloudflareinsights.com is the
  // beacon data endpoint paired with the script allowlisted above.
  "connect-src 'self' https://cloudflareinsights.com",
  "font-src 'self' data:",
  // Allowed embedders: the main app (for the outer iframe embed) AND
  // `'self'` — the viewer iframes its OWN blob: URL to render the
  // PDF, which inherits the viewer's CSP. Without `'self'` the
  // blob iframe is blocked and the viewer shows blank.
  "frame-ancestors 'self' https://securewarp.com https://www.securewarp.com",
  "frame-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  // Safari's built-in PDF viewer (and Firefox's PDF.js) spawns a blob:
  // worker for rendering. `'none'` blocks that and the PDF stays blank.
  // The isolation guarantee still holds — workers inherit their parent
  // document's origin, and connect-src 'self' confines any network
  // calls a worker tries to make.
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const viewerHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Content-Security-Policy", value: viewerCsp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), usb=(), serial=(), payment=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Cross-origin so the main app can embed the iframe. The CSP
  // `frame-ancestors` still locks down WHICH origins may embed.
  { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
];

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    // 2-year max-age with preload eligibility. Only set in production
    // builds to avoid breaking local http:// dev.
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // SAMEORIGIN matches our CSP `frame-ancestors 'self'`. It lets
  // the main app iframe its own pages (needed for the same-origin
  // blob PDF fallback) while continuing to block any external site
  // from embedding us.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
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
  // Inlined into the client bundle. Next.js only reads `process.env`
  // and `.env*` files at build time, so anything living in
  // wrangler.jsonc `vars` (runtime-only) has to be forwarded here to
  // actually reach the browser. See readWranglerPublicVars above.
  env: {
    NEXT_PUBLIC_BUILD_VERSION: getBuildVersion(),
    ...readWranglerPublicVars(),
  },
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
        // Viewer gets a tighter, embedder-friendly header set. The
        // catch-all below explicitly excludes the viewer paths via a
        // negative lookahead — if both rules matched, Next.js would
        // apply them in order and the later catch-all would overwrite
        // the viewer headers (frame-ancestors, X-Frame-Options, CORP)
        // with the main-app values. Observed in prod: the viewer came
        // back with X-Frame-Options: DENY, which blocks embedding.
        // The Office viewers (/viewer/docx, /viewer/xlsx) need the
        // same embedder-friendly headers so they're matched here too.
        source: "/viewer/:path*",
        headers: viewerHeaders,
      },
      {
        source: "/viewer",
        headers: viewerHeaders,
      },
      {
        // Apply on every other route. Negative lookahead excludes the
        // /viewer family so its header set isn't clobbered by this
        // catch-all.
        source: "/((?!viewer$|viewer/).*)",
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
