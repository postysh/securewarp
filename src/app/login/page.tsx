"use client";

import { useRouter } from "next/navigation";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthScreen } from "@/components/auth-screen";

export default function LoginPage() {
  const router = useRouter();

  return (
    <ThemeProvider>
      <AuthScreen mode="login" onAuth={() => router.push("/drive")} />
    </ThemeProvider>
  );
}
