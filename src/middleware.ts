import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { isMaintenanceEnabled, isMaintenanceExempt, maintenanceResponse } from "@/lib/maintenance";

const SESSION_COOKIE = "securewarp_session";

const protectedRoutes = ["/drive", "/admin", "/welcome"];
// Only /login redirects away when a session is live — visiting /login
// with an active cookie is almost always a misclick, so we bounce to
// /drive. /signup is intentionally NOT in this list: clicking "Sign
// up" is an explicit "I want a new account" signal, so we let the
// page render the signup form even if a cookie is still active. The
// new signup replaces the prior session on success.
const authRoutes = ["/login"];

// The isolated PDF viewer subdomain. Only `/viewer` is meaningful
// here; every other path redirects back to the main app so the
// subdomain doesn't accidentally become a second surface for
// authentication or account UI. Stored as a constant so a typo in
// one place doesn't silently break the lockdown.
const PDF_SUBDOMAIN_HOST = "pdf.securewarp.com";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Host-based routing for the isolated PDF viewer subdomain. We
  // don't serve anything other than /viewer there — no login, no
  // drive UI, no API endpoints. Everything else redirects so a
  // wandering user lands on the main app.
  const host = request.headers.get("host")?.toLowerCase() ?? "";

  // Canonicalize `www.securewarp.com` → `securewarp.com`. The
  // session cookie is host-locked (see comment in session.ts), so a
  // user with a cookie on the bare host who lands on www gets a 401
  // on every authed request. Always redirect to bare so the cookie
  // is sent. Localhost / preview hosts pass through unchanged.
  //
  // Webhook paths are exempt: external providers (Stripe, etc.) call
  // them with no cookie, and most don't follow redirects on POST —
  // a stale URL in a provider dashboard would silently 308-fail
  // every delivery. Serve these on www too so a misconfiguration
  // doesn't take down billing sync.
  if (host === "www.securewarp.com" && !pathname.startsWith("/api/billing/webhook")) {
    return NextResponse.redirect(
      new URL(`${pathname}${search}`, "https://securewarp.com"),
      308,
    );
  }

  // Maintenance mode closes the whole site: pages get a static 503
  // page, API routes get a 503 JSON body. Runs after the www redirect
  // so the closed page is only ever served from the bare host, and
  // before everything else so no session check can let anyone past.
  // See src/lib/maintenance.ts for why this is a Worker secret rather
  // than an app_settings flag.
  if (isMaintenanceEnabled(process.env.MAINTENANCE_MODE) && !isMaintenanceExempt(pathname)) {
    return maintenanceResponse(pathname, process.env.SUPPORT_INBOX);
  }

  if (host === PDF_SUBDOMAIN_HOST) {
    // Allow the PDF viewer plus the Office (docx/xlsx) viewers, all
    // under the /viewer prefix. Each renderer is a separate route so
    // its (heavy) library deps lazy-load only when that file type is
    // opened. Static assets (_next/static/*) bypass middleware
    // automatically. Everything else on the subdomain redirects so
    // the origin doesn't accidentally serve auth/account UI.
    if (
      pathname !== "/viewer" &&
      pathname !== "/viewer/docx" &&
      pathname !== "/viewer/xlsx"
    ) {
      return NextResponse.redirect(new URL(pathname, "https://securewarp.com"));
    }
    // Serve viewer routes without running auth checks; the pages are
    // anonymous by design.
    return NextResponse.next();
  }

  // The matcher runs on every path (so maintenance mode can close all
  // of them), but only these routes act on the session. Skip the JWT
  // verify everywhere else rather than paying for it on each API call.
  const isProtected = protectedRoutes.some((r) => pathname.startsWith(r));
  const isAuthRoute = authRoutes.some((r) => pathname.startsWith(r));
  if (!isProtected && !isAuthRoute) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;

  let isAuthenticated = false;
  if (token) {
    try {
      const secretStr = process.env.SESSION_SECRET;
      if (!secretStr || secretStr.length < 32) return NextResponse.redirect(new URL("/login", request.url));
      const secret = new TextEncoder().encode(secretStr);
      await jwtVerify(token, secret);
      isAuthenticated = true;
    } catch {
      // Invalid or expired token
    }
  }

  // Redirect unauthenticated users away from protected routes
  if (isProtected && !isAuthenticated) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect authenticated users away from auth routes
  if (isAuthRoute && isAuthenticated) {
    return NextResponse.redirect(new URL("/drive", request.url));
  }

  return NextResponse.next();
}

// Using the `middleware.ts` convention (edge runtime) rather than Next 16's
// `proxy.ts` (Node runtime only). @opennextjs/cloudflare requires edge
// middleware, and `jose` + `jwtVerify` work fine on edge since they rely on
// Web Crypto. The `middleware` convention is deprecated-but-supported in
// Next 16; revisit if a future OpenNext version supports Node proxy.
//
// The matcher covers every path except build output and public/ files
// (anything ending in a file extension: fonts, icons, images). It used
// to list only the auth-sensitive routes plus the www/pdf hosts, but
// maintenance mode has to be able to close `/`, the marketing pages,
// share links and `/api/*` as well. Per-path behaviour lives in the
// function body; src/middleware.test.ts pins what matches.
export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)"],
};
