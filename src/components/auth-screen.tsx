"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { TurnstileChallenge, isTurnstileEnabled } from "./turnstile-challenge";
import {
  readLockCacheMeta,
  clearLockCache,
  type LockCacheMeta,
} from "@/lib/auth/lock-cache";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
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

export function AuthScreen({ mode: initialMode = "login", onUnlocked }: { mode?: Mode; onUnlocked?: () => void }) {
  const [mode, setMode] = useState<Mode>(initialMode);
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
  useEffect(() => {
    // Only in login mode — the /signup route explicitly wants a fresh
    // account flow even if a cache happens to exist (e.g. a user
    // wants to create a second account on the same device).
    if (initialMode !== "login") return;
    const meta = readLockCacheMeta();
    if (meta) setLockCache(meta);
  }, [initialMode]);

  // Turnstile token for the main (login/signup) form. A second slot
  // exists for the recovery form below so the two widgets don't share
  // state across tabs.
  const [primaryTurnstileToken, setPrimaryTurnstileToken] = useState<string | null>(null);
  const [recoveryTurnstileToken, setRecoveryTurnstileToken] = useState<string | null>(null);
  const primaryTurnstileResetRef = useRef<(() => void) | null>(null);
  const recoveryTurnstileResetRef = useRef<(() => void) | null>(null);

  const turnstileRequired = isTurnstileEnabled();
  const primaryReady = !turnstileRequired || primaryTurnstileToken !== null;
  const recoveryReady = !turnstileRequired || recoveryTurnstileToken !== null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (lockCache) {
      // Fast path — local unlock. No Turnstile, no SRP, no server.
      if (unlockPassword.length === 0) return;
      await auth.unlock(unlockPassword);
      setUnlockPassword("");
      const stored = sessionStorage.getItem("securewarp_keys");
      if (stored && onUnlocked) onUnlocked();
      return;
    }

    if (mode === "signup") {
      if (password !== confirmPassword) {
        return;
      }
      if (password.length < 8) {
        return;
      }
      await auth.signup(email, password, primaryTurnstileToken ?? undefined);
    } else {
      await auth.login(email, password, primaryTurnstileToken ?? undefined);
    }
    // Turnstile tokens are single-use. Reset on submit so the user
    // can retry after an error without page refresh.
    setPrimaryTurnstileToken(null);
    primaryTurnstileResetRef.current?.();
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
        />
      )}

      {/* Card */}
      <div className="w-full max-w-[960px] min-h-0 max-h-[95vh] md:h-[600px] rounded-3xl border border-border-tertiary overflow-hidden flex bg-bg-main" style={{ boxShadow: "var(--shadow-l2)" }}>
        {/* Left branding panel */}
        <div className="hidden lg:flex lg:w-[45%] bg-cta-primary relative overflow-hidden flex-col p-12 rounded-l-2xl">
          <div className="relative z-10 flex items-center gap-2.5 mb-auto">
            <div className="w-8 h-8 rounded-lg bg-accent-green flex items-center justify-center">
              <HugeiconsIcon icon={Shield01Icon} size={16} color="white" />
            </div>
            <span className="font-semibold text-[15px] text-text-inverse tracking-[-0.01em]">
              SecureWarp
            </span>
          </div>

          <div className="relative z-10 my-auto space-y-8">
            <h1 className="text-[36px] font-bold text-text-inverse leading-[1.15] tracking-[-0.02em]">
              Your files.<br />Your keys.<br />Zero knowledge.
            </h1>
            <p className="text-text-inverse/60 text-[15px] max-w-[380px] leading-relaxed">
              End-to-end encrypted cloud storage where only you hold the keys.
            </p>
            <div className="space-y-4 text-text-inverse/50 text-[13px]">
              <div className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-accent-green shrink-0" />
                Client-side encryption, keys never leave your browser
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-accent-green shrink-0" />
                SRP authentication, password never sent to server
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-accent-green shrink-0" />
                Curve25519, xsalsa20-poly1305, Argon2id
              </div>
            </div>
          </div>

          <p className="relative z-10 text-text-inverse/30 text-[11px] font-mono mt-auto">
            Zero-knowledge architecture
          </p>
        </div>

        {/* Right form panel */}
        <div className="flex-1 flex items-center justify-center p-12 overflow-y-auto">
          <FadeIn keyVal={lockCache ? "unlock" : mode}>
          <div className="w-full max-w-[340px]">
            {/* Mobile logo */}
            <div className="lg:hidden flex items-center gap-2 mb-8">
              <div className="w-7 h-7 rounded-lg bg-accent-green flex items-center justify-center">
                <HugeiconsIcon icon={Shield01Icon} size={16} color="white" />
              </div>
              <span className="font-semibold text-[14px] text-text-primary">SecureWarp</span>
            </div>

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
                <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-green-bg text-[12px] text-accent-green">
                  <HugeiconsIcon icon={Shield01Icon} size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Zero-knowledge auth</p>
                    <p className="opacity-70 mt-0.5">Your password derives encryption keys locally. It never reaches our servers.</p>
                  </div>
                </div>
              )}

              {!lockCache && (
                <TurnstileChallenge
                  onToken={(t) => setPrimaryTurnstileToken(t)}
                  onExpire={() => setPrimaryTurnstileToken(null)}
                  resetRef={primaryTurnstileResetRef}
                />
              )}

              <button
                type="submit"
                disabled={
                  auth.loading ||
                  (lockCache ? unlockPassword.length === 0 : !primaryReady || (mode === "signup" && password !== confirmPassword))
                }
                className="w-full flex items-center justify-center gap-2 h-[40px] rounded-[10px] bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {auth.loading ? (
                  <span className="text-[12px]">{auth.step || "Processing..."}</span>
                ) : !lockCache && !primaryReady ? (
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
                    <>No account? <button onClick={() => router.push("/signup")} className="text-text-link hover:underline font-medium cursor-pointer">Sign up</button></>
                  ) : (
                    <>Have an account? <button onClick={() => router.push("/login")} className="text-text-link hover:underline font-medium cursor-pointer">Sign in</button></>
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
                  recoveryTurnstileToken ?? undefined
                );
                setRecoveryTurnstileToken(null);
                recoveryTurnstileResetRef.current?.();
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

              <TurnstileChallenge
                onToken={(t) => setRecoveryTurnstileToken(t)}
                onExpire={() => setRecoveryTurnstileToken(null)}
                resetRef={recoveryTurnstileResetRef}
              />

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
                    !recoveryReady ||
                    (newPassword !== confirmNewPassword) ||
                    !recoveryWords.trim()
                  }
                  className="h-[34px] px-4 rounded-[8px] text-[12px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
                >
                  {auth.loading
                    ? (auth.step || "Processing...")
                    : !recoveryReady
                      ? "Verifying human…"
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
