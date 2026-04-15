"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ThemeProvider } from "@/components/theme-provider";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { AuthScreen } from "@/components/auth-screen";

/**
 * Post-signup wizard. Middleware already guards /welcome against
 * unauthenticated requests. This page additionally checks that the user
 * has unlocked keys in sessionStorage — otherwise the workspace step
 * can't run. When keys are missing (e.g. the user refreshed after
 * signup but before the wizard opened), we inline AuthScreen so they
 * can unlock in place, mirroring drive-client's pattern.
 */
export default function WelcomePage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [hasKeys, setHasKeys] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setHasKeys(sessionStorage.getItem("securewarp_keys") !== null);
    };
    refresh();
    setHydrated(true);
    window.addEventListener("securewarp-keys-updated", refresh);
    return () => window.removeEventListener("securewarp-keys-updated", refresh);
  }, [router]);

  if (!hydrated) return null;

  return (
    <ThemeProvider>
      {hasKeys ? <OnboardingWizard /> : <AuthScreen mode="login" />}
    </ThemeProvider>
  );
}
