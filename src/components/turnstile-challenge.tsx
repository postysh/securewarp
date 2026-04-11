"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useRef } from "react";

/**
 * Wrapper around the Cloudflare Turnstile widget that's a no-op when
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` isn't set at build time.
 *
 * The server-side verifier (`src/lib/auth/turnstile.ts`) uses the same
 * flag-gated pattern via `TURNSTILE_SECRET_KEY`: both sides are off by
 * default and flip on together when an operator provisions the
 * Cloudflare Turnstile site and adds the keys to Vercel.
 *
 * Integration contract: the parent form stores the current token in a
 * React state cell and passes it through to the auth fetch calls as
 * `turnstileToken` on the request body. When the site key is unset,
 * nothing renders, nothing is passed, and the server's verifier
 * returns `skipped` so auth continues to work locally without any
 * Cloudflare account.
 */
interface TurnstileChallengeProps {
  onToken: (token: string) => void;
  onExpire?: () => void;
  // When the parent form submits and needs a fresh token (e.g. after
  // a failed attempt that consumed the current one), call reset().
  resetRef?: React.MutableRefObject<(() => void) | null>;
}

export function TurnstileChallenge({ onToken, onExpire, resetRef }: TurnstileChallengeProps) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  // Local ref to the underlying Turnstile instance so the parent can
  // trigger a reset after a submit without re-mounting the widget.
  const widgetRef = useRef<TurnstileInstance | null>(null);

  if (!siteKey) {
    // No site key at build time → Turnstile is disabled.
    // Tell the parent there's no token to worry about so its submit
    // guard doesn't block forever waiting for one.
    return null;
  }

  return (
    <div className="flex justify-center my-3">
      <Turnstile
        ref={(r) => {
          widgetRef.current = r ?? null;
          if (resetRef) resetRef.current = () => r?.reset();
        }}
        siteKey={siteKey}
        onSuccess={onToken}
        onExpire={() => {
          if (onExpire) onExpire();
        }}
        options={{
          theme: "auto",
          // Managed gives Cloudflare freedom to challenge or auto-pass
          // per risk signals. Matches the dashboard widget default.
          appearance: "always",
          size: "normal",
        }}
      />
    </div>
  );
}

/**
 * True when Turnstile is provisioned (the build has a site key). Forms
 * that want to block submission until the user has solved the challenge
 * can use this to decide whether to require a token.
 */
export function isTurnstileEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}
