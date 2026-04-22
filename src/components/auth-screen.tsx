"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { TurnstileChallenge, isTurnstileEnabled } from "./turnstile-challenge";
import {
  readLockCacheMeta,
  clearLockCache,
  type LockCacheMeta,
} from "@/lib/auth/lock-cache";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import { BrandMark } from "./brand-mark";
import ViewIcon from "@hugeicons/core-free-icons/ViewIcon";
import ViewOffIcon from "@hugeicons/core-free-icons/ViewOffIcon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import Mail01Icon from "@hugeicons/core-free-icons/Mail01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Sun01Icon from "@hugeicons/core-free-icons/Sun01Icon";
import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";
import Key02Icon from "@hugeicons/core-free-icons/Key02Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import { useTheme } from "./theme-provider";
import { useAuth } from "@/hooks/use-auth";
import { RecoveryKeyModal } from "./recovery-key-modal";

type Mode = "login" | "signup";

function FadeIn({ children, keyVal }: { children: React.ReactNode; keyVal: string }) {
  return (
    <div key={keyVal} className="animate-fade-in">
      {children}
    </div>
  );
}

export function AuthScreen({ mode = "login" }: { mode?: Mode }) {
  // `mode` is read directly from props. Using local state initialized
  // from the prop would bite here: Next's App Router keeps the same
  // AuthScreen instance alive when navigating /login ↔ /signup (both
  // routes render this component), so a useState initializer would
  // only pick up the first mode and subsequent link clicks would
  // change the URL without changing the form.
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryWords, setRecoveryWords] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const { theme, toggle } = useTheme();
  const auth = useAuth();

  // Detect a cached lock-cache blob on mount. When present, we switch
  // the UI into "unlock" mode — password-only form, email pre-filled,
  // no SRP, no server round-trip. Users who signed up or logged in
  // on this device previously hit this path on tab reopen; first
  // visit + explicit logout both clear the cache and fall back to the
  // normal login/signup form.
  const [lockCache, setLockCache] = useState<LockCacheMeta | null>(null);
  const [unlockPassword, setUnlockPassword] = useState("");

  // Public feature-flag snapshot. `null` = still loading (don't render
  // the signup form yet or we'd briefly show it just to replace it
  // with a disabled notice). `true`/`false` = known state.
  const [signupsEnabled, setSignupsEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (mode !== "signup") { setSignupsEnabled(true); return; }
    // 3s timeout — if the flag read hangs (cold Worker, slow Supabase),
    // we fall open and show the form anyway. The blank-panel loading
    // state was the root cause of "sign-up link doesn't work" reports:
    // fetch with no timeout would leave `signupsEnabled === null`
    // forever and the signup form would never render. Matches the
    // route handler's fail-open policy for the same reason.
    fetch("/api/config", { signal: AbortSignal.timeout(3000) })
      .then((r) => (r.ok ? r.json() : { signupsEnabled: true }))
      .then((d) => setSignupsEnabled(Boolean(d.signupsEnabled)))
      .catch(() => setSignupsEnabled(true));
  }, [mode]);
  useEffect(() => {
    // Only in login mode — the /signup route explicitly wants a fresh
    // account flow even if a cache happens to exist (e.g. a user
    // wants to create a second account on the same device).
    if (mode !== "login") return;
    const meta = readLockCacheMeta();
    if (meta) setLockCache(meta);
  }, [mode]);

  // Turnstile token for signup only. Login + recovery are already
  // protected by SRP + Argon2id + rate limiter, which make automated
  // attacks expensive enough that Turnstile would be cosmetic there.
  const [signupTurnstileToken, setSignupTurnstileToken] = useState<string | null>(null);
  const signupTurnstileResetRef = useRef<(() => void) | null>(null);

  const turnstileRequired = isTurnstileEnabled();
  const signupReady = mode !== "signup" || !turnstileRequired || signupTurnstileToken !== null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (lockCache) {
      // Fast path — local unlock. No Turnstile, no SRP, no server.
      if (unlockPassword.length === 0) return;
      await auth.unlock(unlockPassword);
      setUnlockPassword("");
      return;
    }

    if (mode === "signup") {
      if (password !== confirmPassword) {
        return;
      }
      if (password.length < 8) {
        return;
      }
      await auth.signup(email, password, signupTurnstileToken ?? undefined);
      // Turnstile tokens are single-use. Reset on submit so the user
      // can retry after an error without page refresh.
      setSignupTurnstileToken(null);
      signupTurnstileResetRef.current?.();
    } else {
      await auth.login(email, password);
    }
  };

  // "Use a different account" — wipes the lock cache and returns to
  // the full login form so a user on a shared device can sign in as
  // someone else. Doesn't log out the current session on the server
  // (that happens naturally when the new login succeeds and issues a
  // fresh cookie).
  const switchAccount = () => {
    clearLockCache();
    setLockCache(null);
    setUnlockPassword("");
  };

  return (
    <div className="h-full flex items-center justify-center bg-bg-side p-4 relative">
      {/* Theme toggle */}
      <button onClick={toggle} className="absolute top-5 right-5 p-2 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer z-10">
        <HugeiconsIcon icon={theme === "dark" ? Sun01Icon : Moon02Icon} size={16} />
      </button>

      {/* Recovery key modal — shown after successful signup */}
      {auth.recoveryKey && (
        <RecoveryKeyModal
          open={true}
          onClose={auth.dismissRecoveryKey}
          recoveryKey={auth.recoveryKey}
          email={email || recoveryEmail || undefined}
        />
      )}

      {/* Card */}
      <div className="w-full max-w-[960px] min-h-0 max-h-[95vh] md:h-[600px] rounded-3xl border border-border-tertiary overflow-hidden flex bg-bg-main" style={{ boxShadow: "var(--shadow-l2)" }}>
        {/* Left branding panel */}
        <div className="hidden lg:flex lg:w-[45%] bg-cta-primary relative overflow-hidden flex-col p-12 rounded-l-2xl">
          {/* Logo — matches the nav bar: monospace, uppercase, no icon */}
          <Link href="/" className="relative z-10 mb-auto no-underline flex items-center gap-2 text-text-inverse">
            <BrandMark size={72} tone="mono" />
            <span className="font-semibold text-[13px]" style={{ fontFamily: "var(--font-geist-mono), monospace", letterSpacing: "0.1em" }}>
              SECUREWARP
            </span>
          </Link>

          {/* Main messaging */}
          <div className="relative z-10 my-auto space-y-6">
            <h1 className="text-[32px] font-bold text-text-inverse leading-[1.2] tracking-[-0.02em]" style={{ textWrap: "balance" }}>
              Encrypted before it leaves your device.
            </h1>
            <p className="text-text-inverse/55 text-[14px] max-w-[340px] leading-relaxed" style={{ textWrap: "pretty" }}>
              When you create an account, we generate encryption keys in your
              browser. Your password never crosses the wire. Files are
              unreadable without keys only you hold.
            </p>

            {/* Benefit list */}
            <div className="space-y-3 pt-2">
              {[
                { label: "Files encrypted before upload", desc: "Content and filenames are ciphertext." },
                { label: "Password never transmitted", desc: "We verify you know it without seeing it." },
                { label: "24 word recovery phrase", desc: "Your second path in. We never see it." },
              ].map((item) => (
                <div key={item.label} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-md bg-text-link/15 flex items-center justify-center mt-0.5 shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-text-link" />
                  </div>
                  <div>
                    <div className="text-text-inverse/90 text-[13px] font-medium">{item.label}</div>
                    <div className="text-text-inverse/40 text-[12px] leading-relaxed mt-0.5" style={{ textWrap: "pretty" }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom strip — aligned with the bullet list above via
              the same gap-3 + w-5 icon column so the dot sits on
              the same vertical axis as the green bullets. */}
          <div className="relative z-10 mt-auto flex items-center gap-3">
            <div className="w-5 flex items-center justify-center shrink-0">
              <div className="w-1.5 h-1.5 rounded-full bg-text-link" style={{ boxShadow: "0 0 6px rgba(239,90,60,0.5)" }} />
            </div>
            <span className="text-text-inverse/30 text-[11px] font-mono">
              Zero knowledge architecture
            </span>
          </div>
        </div>

        {/* Right form panel */}
        <div className="flex-1 flex items-center justify-center p-12 overflow-y-auto">
          <FadeIn keyVal={lockCache ? "unlock" : mode}>
          <div className="w-full max-w-[340px]">
            {/* Mobile logo — matches nav bar style */}
            <Link href="/" className="lg:hidden mb-8 no-underline flex items-center gap-2 text-text-primary">
              <BrandMark size={72} tone="mono" />
              <span className="font-semibold text-[13px]" style={{ fontFamily: "var(--font-geist-mono), monospace", letterSpacing: "0.1em" }}>
                SECUREWARP
              </span>
            </Link>

            {mode === "signup" && signupsEnabled === null ? (
              /* Config fetch in flight on signup mount. Render nothing
                 for the panel body so we don't briefly show the form
                 only to replace it with the "Signups unavailable"
                 notice if the flag turns out to be off. The surrounding
                 panel + logo still render, so the page isn't blank. */
              <div className="h-[320px]" aria-hidden />
            ) : mode === "signup" && signupsEnabled === false ? (
              /* Signups disabled via feature flag. Render a clean
                 "come back later" notice instead of the form so users
                 don't fill in fields that would 503 on submit. */
              <>
                <div className="w-12 h-12 rounded-[12px] bg-accent-yellow-bg flex items-center justify-center mb-5">
                  <HugeiconsIcon icon={Shield01Icon} size={22} color="var(--accent-yellow-primary)" />
                </div>
                <h2 className="text-[22px] font-semibold text-text-primary tracking-[-0.02em] mb-2">
                  Signups unavailable
                </h2>
                <p className="text-text-secondary text-[13px] leading-relaxed mb-6">
                  New accounts are temporarily disabled. Check back later, but existing users
                  can still sign in.
                </p>
                <Link
                  href="/login"
                  className="block w-full h-[40px] rounded-[10px] bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer flex items-center justify-center"
                >
                  Back to sign in
                </Link>
              </>
            ) : auth.suspended ? (
              /* Suspension notice — replaces the login form entirely so
                 the user can't keep trying to get in. Zero-knowledge
                 means we never reveal WHY in the password response, but
                 once the server tells us they're suspended, the UI
                 surfaces it plainly. */
              <>
                <div className="w-12 h-12 rounded-[12px] bg-accent-red/12 flex items-center justify-center mb-5">
                  <HugeiconsIcon icon={Shield01Icon} size={22} color="var(--accent-red-primary)" />
                </div>
                <h2 className="text-[22px] font-semibold text-text-primary tracking-[-0.02em] mb-2">
                  Account suspended
                </h2>
                <p className="text-text-secondary text-[13px] leading-relaxed mb-5">
                  You can&apos;t sign in until suspension is lifted. Your files and keys are
                  preserved in the meantime and nothing has been deleted.
                </p>
                {auth.suspended.reason && (
                  <div className="mb-5 p-3 rounded-lg bg-bg-field whitespace-pre-wrap break-words">
                    <span className="block text-[10px] font-mono uppercase tracking-wider text-text-disabled mb-1">Reason</span>
                    <span className="text-[12px] text-text-primary">{auth.suspended.reason}</span>
                  </div>
                )}
                <p className="text-text-tertiary text-[12px] leading-relaxed mb-6">
                  If you believe this is a mistake, reply to your last email from us or contact{" "}
                  <a href="mailto:support@securewarp.com" className="text-text-link hover:underline">
                    support@securewarp.com
                  </a>
                  .
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="w-full h-[40px] rounded-[10px] bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer"
                >
                  Back to sign in
                </button>
              </>
            ) : auth.pending2FA ? (
              /* ── 2FA code entry ──────────────────────────────────── */
              <TwoFactorPrompt
                error={auth.error}
                loading={auth.loading}
                onSubmit={(code) => auth.verify2FA(code)}
              />
            ) : (
              <>
            <h2 className="text-[22px] font-semibold text-text-primary tracking-[-0.02em] mb-1">
              {lockCache ? "Unlock your vault" : mode === "login" ? "Welcome back" : "Create account"}
            </h2>
            <p className="text-text-tertiary text-[13px] mb-7">
              {lockCache
                ? "Enter your password to decrypt your keys"
                : mode === "login"
                  ? "Sign in to access your encrypted files"
                  : "Set up your zero-knowledge vault"}
            </p>

            {/* Error message */}
            {auth.error && (
              <div className="mb-4 p-3 rounded-lg bg-accent-red/10 border border-accent-red/20 text-[12px] text-accent-red">
                {auth.error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {lockCache ? (
                <div>
                  <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">Account</label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-icon-tertiary">
                      <HugeiconsIcon icon={Mail01Icon} size={16} />
                    </div>
                    <div className="w-full pl-10 pr-4 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-secondary border border-transparent truncate">
                      {lockCache.email}
                    </div>
                  </div>
                </div>
              ) : (
              <div>
                <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">Email</label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-icon-tertiary">
                    <HugeiconsIcon icon={Mail01Icon} size={16} />
                  </div>
                  <input
                    type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    disabled={auth.loading}
                    className="w-full pl-10 pr-4 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40 disabled:opacity-50"
                  />
                </div>
              </div>
              )}

              {lockCache ? (
                <div>
                  <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">Password</label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-icon-tertiary">
                      <HugeiconsIcon icon={LockIcon} size={16} />
                    </div>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={unlockPassword}
                      onChange={(e) => setUnlockPassword(e.target.value)}
                      placeholder="Enter your password"
                      required
                      autoFocus
                      disabled={auth.loading}
                      className="w-full pl-10 pr-10 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40 disabled:opacity-50"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-icon-tertiary hover:text-icon-secondary transition-colors cursor-pointer">
                      <HugeiconsIcon icon={showPassword ? ViewOffIcon : ViewIcon} size={16} />
                    </button>
                  </div>
                </div>
              ) : (
              <div>
                <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">Password</label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-icon-tertiary">
                    <HugeiconsIcon icon={LockIcon} size={16} />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    minLength={8}
                    disabled={auth.loading}
                    className="w-full pl-10 pr-10 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40 disabled:opacity-50"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-icon-tertiary hover:text-icon-secondary transition-colors cursor-pointer">
                    <HugeiconsIcon icon={showPassword ? ViewOffIcon : ViewIcon} size={16} />
                  </button>
                </div>
              </div>
              )}

              {!lockCache && mode === "signup" && (
                <div>
                  <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">Confirm password</label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-icon-tertiary">
                      <HugeiconsIcon icon={LockIcon} size={16} />
                    </div>
                    <input
                      type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm your password"
                      required
                      disabled={auth.loading}
                      className="w-full pl-10 pr-4 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40 disabled:opacity-50"
                    />
                  </div>
                  {password && confirmPassword && password !== confirmPassword && (
                    <p className="text-[11px] text-accent-red mt-1.5 px-1">Passwords don&apos;t match</p>
                  )}
                </div>
              )}

              {!lockCache && mode === "signup" && (
                <TurnstileChallenge
                  onToken={(t) => setSignupTurnstileToken(t)}
                  onExpire={() => setSignupTurnstileToken(null)}
                  resetRef={signupTurnstileResetRef}
                />
              )}

              <button
                type="submit"
                disabled={
                  auth.loading ||
                  (lockCache ? unlockPassword.length === 0 : !signupReady || (mode === "signup" && password !== confirmPassword))
                }
                className="w-full flex items-center justify-center gap-2 h-[40px] rounded-[10px] bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {auth.loading ? (
                  <span className="text-[12px]">{auth.step || "Processing..."}</span>
                ) : !lockCache && !signupReady ? (
                  <span className="text-[12px]">Verifying human…</span>
                ) : (
                  <>
                    {lockCache ? "Unlock" : mode === "login" ? "Sign in" : "Create account"}
                    <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
                  </>
                )}
              </button>
            </form>

            {lockCache ? (
              <p className="mt-5 text-center text-[13px] text-text-tertiary">
                <button onClick={switchAccount} className="text-text-link hover:underline font-medium cursor-pointer">
                  Use a different account
                </button>
              </p>
            ) : (
              <>
                <p className="mt-5 text-center text-[13px] text-text-tertiary">
                  {mode === "login" ? (
                    <>No account? <Link href="/signup" className="text-text-link hover:underline font-medium cursor-pointer">Sign up</Link></>
                  ) : (
                    <>Have an account? <Link href="/login" className="text-text-link hover:underline font-medium cursor-pointer">Sign in</Link></>
                  )}
                </p>

                {mode === "login" && (
                  <p className="mt-2 text-center">
                    <button onClick={() => setShowRecovery(true)} className="text-[11px] text-text-disabled hover:text-text-tertiary transition-colors cursor-pointer">
                      Recover with recovery key
                    </button>
                  </p>
                )}
              </>
            )}
              </>
            )}
          </div>
          </FadeIn>
        </div>
      </div>

      {/* Recovery modal */}
      {showRecovery && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div className="absolute inset-0 bg-bg-scrim backdrop-blur-sm animate-fade-in" onClick={() => !auth.loading && setShowRecovery(false)} />
          <div className="relative w-full max-w-[440px] mx-4 rounded-2xl bg-bg-l3 border border-border-primary overflow-hidden animate-fade-in" style={{ boxShadow: "var(--shadow-l2)" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-tertiary">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center">
                  <HugeiconsIcon icon={Key02Icon} size={18} color="var(--accent-yellow-primary)" />
                </div>
                <span className="text-[14px] font-semibold text-text-primary">Account Recovery</span>
              </div>
              {!auth.loading && (
                <button onClick={() => setShowRecovery(false)} className="p-1.5 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer">
                  <HugeiconsIcon icon={Cancel01Icon} size={16} />
                </button>
              )}
            </div>

            {/* Body */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (newPassword !== confirmNewPassword) return;
                if (newPassword.length < 8) return;
                await auth.recover(
                  recoveryEmail,
                  recoveryWords,
                  newPassword,
                );
              }}
              className="px-5 py-5 space-y-4"
            >
              {auth.error && (
                <div className="p-3 rounded-lg bg-accent-red/10 border border-accent-red/20 text-[12px] text-accent-red">
                  {auth.error}
                </div>
              )}

              <div>
                <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">Email</label>
                <input
                  type="email"
                  value={recoveryEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  disabled={auth.loading}
                  className="w-full px-3.5 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">Recovery Phrase</label>
                <textarea
                  value={recoveryWords}
                  onChange={(e) => setRecoveryWords(e.target.value)}
                  placeholder="Paste your 24-word recovery phrase here..."
                  required
                  disabled={auth.loading}
                  rows={3}
                  className="w-full px-3.5 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40 disabled:opacity-50 resize-none font-mono"
                />
                <p className="text-[10px] text-text-disabled mt-1 px-1">Paste the entire phrase as copied or from your backup file</p>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  required
                  minLength={8}
                  disabled={auth.loading}
                  className="w-full px-3.5 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">Confirm New Password</label>
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Confirm new password"
                  required
                  disabled={auth.loading}
                  className="w-full px-3.5 py-2.5 rounded-[10px] bg-bg-field text-[13px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-accent-green/25 transition-all border border-transparent focus:border-accent-green/40 disabled:opacity-50"
                />
                {newPassword && confirmNewPassword && newPassword !== confirmNewPassword && (
                  <p className="text-[11px] text-accent-red mt-1.5 px-1">Passwords don&apos;t match</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setShowRecovery(false)}
                  disabled={auth.loading}
                  className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium text-text-secondary hover:bg-cta-secondary-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    auth.loading ||
                    (newPassword !== confirmNewPassword) ||
                    !recoveryWords.trim()
                  }
                  className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
                >
                  {auth.loading
                    ? (auth.step || "Processing...")
                    : "Recover account"}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}


function TwoFactorPrompt({
  error,
  loading,
  onSubmit,
}: {
  error: string | null;
  loading: boolean;
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length === 6 && !loading) onSubmit(code);
  };

  return (
    <>
      <h2 className="text-[22px] font-semibold text-text-primary tracking-[-0.02em] mb-1">
        Two factor authentication
      </h2>
      <p className="text-text-tertiary text-[13px] mb-7">
        Enter the 6 digit code from your authenticator app.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-accent-red/10 border border-accent-red/20 text-[12px] text-accent-red">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">
            Verification code
          </label>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="w-full h-[40px] rounded-[10px] bg-bg-field border border-border-secondary px-3.5 text-[14px] text-text-primary placeholder:text-text-disabled focus:border-accent-green focus:outline-none transition-colors font-mono text-center text-[20px] tracking-[0.3em]"
          />
        </div>
        <button
          type="submit"
          disabled={code.length !== 6 || loading}
          className="w-full h-[40px] rounded-[10px] bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 disabled:cursor-default"
        >
          {loading ? "Verifying..." : "Verify"}
        </button>
      </form>
    </>
  );
}
