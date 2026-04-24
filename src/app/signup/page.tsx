"use client";

import { ThemeProvider } from "@/components/theme-provider";
import { AuthScreen } from "@/components/auth-screen";

// Same caching contract as /login — static prerender + CF
// edge-cache bypass via Cache-Control: no-store from next.config.ts,
// instead of force-dynamic which kills <Link> prefetch.
export default function SignupPage() {
  return (
    <ThemeProvider>
      <AuthScreen mode="signup" />
    </ThemeProvider>
  );
}
