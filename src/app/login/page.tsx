"use client";

import { ThemeProvider } from "@/components/theme-provider";
import { AuthScreen } from "@/components/auth-screen";

// Force dynamic so CF's edge cache doesn't serve a stale "log in"
// form to authenticated users in a second tab. When this file was
// implicitly static, OpenNext set `cache-control: s-maxage=31536000`
// on the response and Cloudflare skipped running middleware.
// Middleware's authRoute→/drive redirect therefore never fired, and
// logged-in users saw the login form on repeat visits from fresh
// tabs. `force-dynamic` runs middleware per request.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <ThemeProvider>
      <AuthScreen mode="login" />
    </ThemeProvider>
  );
}
