"use client";

import { ThemeProvider } from "@/components/theme-provider";
import { AuthScreen } from "@/components/auth-screen";

// Same reason as /login — force dynamic so middleware runs per
// request and authenticated users get redirected to /drive instead
// of seeing a stale cached signup form. See login/page.tsx.
export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <ThemeProvider>
      <AuthScreen mode="signup" />
    </ThemeProvider>
  );
}
