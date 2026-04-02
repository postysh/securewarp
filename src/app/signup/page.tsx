"use client";

import { ThemeProvider } from "@/components/theme-provider";
import { AuthScreen } from "@/components/auth-screen";

export default function SignupPage() {
  return (
    <ThemeProvider>
      <AuthScreen mode="signup" />
    </ThemeProvider>
  );
}
