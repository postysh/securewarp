"use client";

import { ThemeProvider } from "@/components/theme-provider";
import { AuthScreen } from "@/components/auth-screen";

// Static prerendering is fine here — the page is "use client" and
// the auth form hydrates entirely on the client. CF's edge cache
// would otherwise let an already-authenticated user (cookie alive
// in another tab) hit the cached form and bypass middleware's
// /login → /drive redirect; that's prevented by the
// `Cache-Control: no-store` header set in next.config.ts for this
// route. We intentionally do NOT set `dynamic = "force-dynamic"`
// because that disables `<Link>` prefetch from the marketing pages,
// turning every click into a 1–2 s blank-loading.tsx round-trip.
export default function LoginPage() {
  return (
    <ThemeProvider>
      <AuthScreen mode="login" />
    </ThemeProvider>
  );
}
