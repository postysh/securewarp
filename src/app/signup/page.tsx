"use client";

import { useRouter } from "next/navigation";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthScreen } from "@/components/auth-screen";

export default function SignupPage() {
  const router = useRouter();

  return (
    <ThemeProvider>
      <AuthScreen mode="signup" onAuth={() => router.push("/drive")} />
    </ThemeProvider>
  );
}
