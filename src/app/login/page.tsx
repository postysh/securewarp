"use client";

import { useRouter } from "next/navigation";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthScreen } from "@/components/auth-screen";
import { clearLockCache } from "@/lib/auth/lock-cache";

export default function LoginPage() {
  const router = useRouter();
  return (
    <ThemeProvider>
      <AuthScreen
        mode="login"
        onUnlocked={async () => {
          // Check if the JWT session is still valid. If the cookie
          // expired, the proxy will bounce /drive back to /login.
          const res = await fetch("/api/auth/session");
          if (res.ok) {
            router.push("/drive");
          } else {
            // JWT expired. The local unlock worked (keys are in
            // sessionStorage) but the server doesn't trust us.
            // Clear the stale lock cache and reload to show the
            // full login form — the user needs to SRP-authenticate
            // to get a fresh JWT.
            sessionStorage.removeItem("securewarp_keys");
            clearLockCache();
            window.location.reload();
          }
        }}
      />
    </ThemeProvider>
  );
}
