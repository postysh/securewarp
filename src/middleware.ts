import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "securewarp_session";

const protectedRoutes = ["/drive", "/admin", "/welcome"];
const authRoutes = ["/login", "/signup"];

// The isolated PDF viewer subdomain. Only `/viewer` is meaningful
// here; every other path redirects back to the main app so the
// subdomain doesn't accidentally become a second surface for
// authentication or account UI. Stored as a constant so a typo in
// one place doesn't silently break the lockdown.
const PDF_SUBDOMAIN_HOST = "pdf.securewarp.com";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Host-based routing for the isolated PDF viewer subdomain. We
  // don't serve anything other than /viewer there — no login, no
  // drive UI, no API endpoints. Everything else redirects so a
  // wandering user lands on the main app.
  const host = request.headers.get("host")?.toLowerCase() ?? "";
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
      return NextResponse.redirect(new URL(pathname, "https://www.securewarp.com"));
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
  ],
};
