import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

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
  if (host === "www.securewarp.com") {
    return NextResponse.redirect(
      new URL(`${pathname}${search}`, "https://securewarp.com"),
      308,
    );
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
  if (protectedRoutes.some((r) => pathname.startsWith(r)) && !isAuthenticated) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect authenticated users away from auth routes
  if (authRoutes.some((r) => pathname.startsWith(r)) && isAuthenticated) {
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
// `has: [{ type: "host", value: PDF_SUBDOMAIN_HOST }]` runs middleware on
// every path for the pdf subdomain so we can enforce the /viewer-only
// rule above. Main-app paths keep their narrow matchers.
export const config = {
  matcher: [
    "/drive/:path*",
    "/admin/:path*",
    "/welcome",
    "/login",
    "/signup",
    {
      source: "/:path*",
      has: [{ type: "host", value: "pdf.securewarp.com" }],
    },
    // Run on every path of `www.securewarp.com` so the canonicalize
    // redirect catches API fetches too. Without this, a fetch to
    // `www.securewarp.com/api/...` bypasses middleware and the
    // cross-host cookie problem stays.
    {
      source: "/:path*",
      has: [{ type: "host", value: "www.securewarp.com" }],
    },
  ],
};
