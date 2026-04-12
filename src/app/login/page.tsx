"use client";

import { ThemeProvider } from "@/components/theme-provider";
import { AuthScreen } from "@/components/auth-screen";

export default function LoginPage() {
  return (
    <ThemeProvider>
      <AuthScreen mode="login" />
    </ThemeProvider>
  );
}
