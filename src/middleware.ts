import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "securewarp_session";

const protectedRoutes = ["/drive"];
const authRoutes = ["/login", "/signup"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
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

export const config = {
  matcher: ["/drive/:path*", "/login", "/signup"],
};
