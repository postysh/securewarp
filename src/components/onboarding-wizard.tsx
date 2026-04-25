"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { BrandMark } from "./brand-mark";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import Sun01Icon from "@hugeicons/core-free-icons/Sun01Icon";
import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import UserIcon from "@hugeicons/core-free-icons/UserIcon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import Mail01Icon from "@hugeicons/core-free-icons/Mail01Icon";
import { useTheme } from "./theme-provider";

type Step = "name" | "workspace" | "recovery-email" | "done";

export function OnboardingWizard() {
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [step, setStep] = useState<Step>("name");
  const [displayName, setDisplayName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<HTMLInputElement>(null);
  const recoveryEmailRef = useRef<HTMLInputElement>(null);

  // Guard: if the server already marked this user onboarded (e.g. they
  // landed here manually on a subsequent device), bounce to /drive. Also
  // pre-fills the displayName field if one's already set, so returning
  // users with partial profiles don't have to retype.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/profile");
        if (!res.ok) { setReady(true); return; }
        const data = await res.json();
        if (cancelled) return;
        if (data.onboarded) { router.replace("/drive"); return; }
        if (typeof data.displayName === "string") setDisplayName(data.displayName);
        setReady(true);
      } catch {
        setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    if (step === "name") setTimeout(() => nameRef.current?.focus(), 50);
    if (step === "workspace") setTimeout(() => wsRef.current?.focus(), 50);
    if (step === "recovery-email") setTimeout(() => recoveryEmailRef.current?.focus(), 50);
  }, [step, ready]);

  async function saveDisplayName() {
    const trimmed = displayName.trim();
    if (!trimmed) return true;
    const res = await fetch("/api/auth/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: trimmed }),
    });
    if (!res.ok) {
      setError("Couldn't save your name. Try again.");
      return false;
    }
    return true;
  }

  async function completeOnboarding() {
    await fetch("/api/auth/onboarding/complete", { method: "POST" });
    router.replace("/drive");
  }

  async function handleNameNext() {
    setBusy(true);
    setError(null);
    const ok = await saveDisplayName();
    setBusy(false);
    if (ok) setStep("workspace");
  }

  async function handleSkipWorkspace() {
    setStep("recovery-email");
  }

  async function handleCreateWorkspace() {
    const trimmed = workspaceName.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const { buildWorkspaceFolder } = await import("@/lib/crypto/workspace-folder");
      const folderPayload = await buildWorkspaceFolder(trimmed);
      const folderRes = await fetch("/api/files/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(folderPayload),
      });
      const folderData = await folderRes.json();
      if (!folderRes.ok) throw new Error(folderData.error || "Failed to create folder");

      const wsRes = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, rootFolderId: folderData.folderId }),
      });
      const wsData = await wsRes.json();
      if (!wsRes.ok) throw new Error(wsData.error || "Failed to create workspace");

      setBusy(false);
      setStep("recovery-email");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setBusy(false);
    }
  }

  if (!ready) return <div className="h-full bg-bg-side" />;

  const stepIndex =
    step === "name" ? 0 : step === "workspace" ? 1 : step === "recovery-email" ? 2 : 3;
  const totalSteps = 3;

  return (
    <div className="min-h-screen flex flex-col bg-bg-side">
      <header className="flex items-center justify-between px-6 py-5">
        <Link
          href="/"
          className="no-underline text-text-primary text-[13px] font-semibold tracking-[1px] hover:opacity-80 transition-opacity flex items-center gap-1"
          style={{ fontFamily: "var(--font-geist-mono), monospace" }}
        >
          <BrandMark size={40} />
          SECUREWARP
        </Link>
        <button
          onClick={toggle}
          className="p-2 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer"
          aria-label="Toggle theme"
        >
          <HugeiconsIcon icon={theme === "dark" ? Sun01Icon : Moon02Icon} size={16} />
        </button>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 pb-10">
        <div className="w-full max-w-[480px]">
          <div
            className="rounded-2xl border border-border-tertiary bg-bg-l3 overflow-hidden"
            style={{ boxShadow: "var(--shadow-l2)" }}
          >
            <div className="bg-bg-side px-6 py-6 border-b border-border-tertiary">
              <div className="flex items-center justify-between mb-4">
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-disabled">
                  Set up your account
                </div>
                <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary">
                  Step {Math.min(stepIndex + 1, totalSteps)} of {totalSteps}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-[3px] flex-1 rounded-full transition-colors"
                    style={{
                      background:
                        i <= stepIndex ? "var(--text-link)" : "rgba(0,0,0,0.08)",
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="px-6 py-7">
              {step === "name" && (
                <StepName
                  displayName={displayName}
                  setDisplayName={setDisplayName}
                  onNext={handleNameNext}
                  busy={busy}
                  error={error}
                  inputRef={nameRef}
                />
              )}

              {step === "workspace" && (
                <StepWorkspace
                  workspaceName={workspaceName}
                  setWorkspaceName={setWorkspaceName}
                  onCreate={handleCreateWorkspace}
                  onSkip={handleSkipWorkspace}
                  busy={busy}
                  error={error}
                  inputRef={wsRef}
                />
              )}

              {step === "recovery-email" && (
                <StepRecoveryEmail
                  inputRef={recoveryEmailRef}
                  onDone={completeOnboarding}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepIcon({ icon }: { icon: typeof UserIcon }) {
  return (
    <div className="w-12 h-12 rounded-xl bg-bg-side border border-border-tertiary flex items-center justify-center mb-4">
      <HugeiconsIcon icon={icon} size={22} color="var(--text-link)" />
    </div>
  );
}

function StepName({
  displayName,
  setDisplayName,
  onNext,
  busy,
  error,
  inputRef,
}: {
  displayName: string;
  setDisplayName: (s: string) => void;
  onNext: () => void;
  busy: boolean;
  error: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="animate-fade-in">
      <StepIcon icon={UserIcon} />
      <h1 className="text-[20px] font-semibold text-text-primary mb-1 tracking-[-0.01em]">
        What should we call you?
      </h1>
      <p className="text-[13px] text-text-tertiary leading-relaxed mb-5">
        Your display name shows up when you share files. That is all we store,
        we cannot see anything else about you.
      </p>

      <input
        ref={inputRef}
        type="text"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !busy) onNext(); }}
        placeholder="Your name"
        maxLength={100}
        className="w-full h-[42px] px-3 rounded-[10px] bg-bg-field border border-transparent text-text-primary text-[14px] placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-text-link/25 focus:border-text-link/40 transition-all"
      />

      {error && <p className="mt-3 text-[12px] text-accent-red">{error}</p>}

      <div className="flex items-center justify-between mt-6">
        <button
          onClick={onNext}
          disabled={busy}
          className="text-[13px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer disabled:opacity-50"
        >
          Skip for now
        </button>
        <button
          onClick={onNext}
          disabled={busy}
          className="flex items-center gap-1.5 px-5 h-[40px] rounded-[10px] bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer active:scale-[0.98] disabled:opacity-50"
        >
          Continue
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
        </button>
      </div>
    </div>
  );
}

function StepWorkspace({
  workspaceName,
  setWorkspaceName,
  onCreate,
  onSkip,
  busy,
  error,
  inputRef,
}: {
  workspaceName: string;
  setWorkspaceName: (s: string) => void;
  onCreate: () => void;
  onSkip: () => void;
  busy: boolean;
  error: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="animate-fade-in">
      <StepIcon icon={UserGroupIcon} />
      <h1 className="text-[20px] font-semibold text-text-primary mb-1 tracking-[-0.01em]">
        Collaborating with a team?
      </h1>
      <p className="text-[13px] text-text-tertiary leading-relaxed mb-5">
        Create a workspace to share a folder with your team. You can always do
        this later from the sidebar.
      </p>

      <input
        ref={inputRef}
        type="text"
        value={workspaceName}
        onChange={(e) => setWorkspaceName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && workspaceName.trim() && !busy) onCreate(); }}
        placeholder="Workspace name (e.g. Acme Inc.)"
        maxLength={100}
        className="w-full h-[42px] px-3 rounded-[10px] bg-bg-field border border-transparent text-text-primary text-[14px] placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-text-link/25 focus:border-text-link/40 transition-all"
      />

      {error && <p className="mt-3 text-[12px] text-accent-red">{error}</p>}

      <div className="flex items-center justify-between mt-6">
        <button
          onClick={onSkip}
          disabled={busy}
          className="text-[13px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer disabled:opacity-50"
        >
          Skip, I will do this later
        </button>
        <button
          onClick={onCreate}
          disabled={busy || !workspaceName.trim()}
          className="flex items-center gap-1.5 px-5 h-[40px] rounded-[10px] bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create workspace"}
          {!busy && <HugeiconsIcon icon={Tick01Icon} size={14} />}
        </button>
      </div>
    </div>
  );
}

function StepRecoveryEmail({
  inputRef,
  onDone,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDone: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"intro" | "form" | "skip-confirm" | "success">("intro");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit() {
    setErr(null);
    const email = recoveryEmail.trim().toLowerCase();
    if (!email) {
      setErr("Enter a recovery email.");
      return;
    }
    const cryptoMod = await import("@/lib/auth/recovery-email-crypto");
    let cleanedPhrase: string;
    try {
      cleanedPhrase = cryptoMod.cleanAndValidateMnemonic(phrase);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Phrase doesn't look right.");
      return;
    }
    setBusy(true);
    try {
      const { hashRecoveryKey } = await import("@/lib/crypto/keys");
      const wrap = await cryptoMod.wrapMnemonicForEmail(cleanedPhrase);
      const recoveryKeyHash = await hashRecoveryKey(cleanedPhrase);

      const res = await fetch("/api/auth/recovery-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recoveryEmail: email,
          recoveryToken: wrap.recoveryToken,
          confirmToken: wrap.confirmToken,
          salt: wrap.salt,
          ciphertext: wrap.ciphertext,
          recoveryKeyHash,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Setup failed");
      }
      setMode("success");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "success") {
    return (
      <div className="animate-fade-in">
        <StepIcon icon={Mail01Icon} />
        <h1 className="text-[20px] font-semibold text-text-primary mb-1 tracking-[-0.01em]">
          Check your inbox
        </h1>
        <p className="text-[13px] text-text-tertiary leading-relaxed mb-5">
          We sent a confirmation link to <span className="text-text-primary">{recoveryEmail}</span>.
          Click it once to activate, then save the email. It contains your one time recovery URL.
        </p>
        <div className="flex items-center justify-end mt-6">
          <button
            onClick={async () => {
              setBusy(true);
              await onDone();
            }}
            disabled={busy}
            className="flex items-center gap-1.5 px-5 h-[40px] rounded-[10px] bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? "Loading…" : "Continue to drive"}
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (mode === "skip-confirm") {
    return (
      <div className="animate-fade-in">
        <div className="w-12 h-12 rounded-xl border border-accent-red/30 bg-accent-red/[0.06] flex items-center justify-center mb-4">
          <HugeiconsIcon icon={Mail01Icon} size={22} color="var(--accent-red-primary)" />
        </div>
        <h1 className="text-[20px] font-semibold text-text-primary mb-1 tracking-[-0.01em]">
          Continue without backup recovery?
        </h1>
        <p className="text-[13px] text-text-tertiary leading-relaxed mb-3">
          Without a recovery email, your 24 word phrase is the only way back into your account if
          you forget your password.
        </p>
        <p className="text-[13px] text-text-primary leading-relaxed mb-5">
          Lose both, and your data is permanently inaccessible. We can&apos;t override this. That&apos;s
          how zero knowledge works.
        </p>

        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setMode("intro")}
            disabled={busy}
            className="text-[13px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer disabled:opacity-50"
          >
            Go back
          </button>
          <button
            onClick={async () => {
              setBusy(true);
              await onDone();
            }}
            disabled={busy}
            className="flex items-center gap-1.5 px-5 h-[40px] rounded-[10px] border border-border-secondary text-text-primary text-[13px] font-medium hover:bg-cta-secondary-hover transition-colors cursor-pointer disabled:opacity-50"
          >
            {busy ? "Loading…" : "Skip anyway"}
          </button>
        </div>
      </div>
    );
  }

  if (mode === "form") {
    return (
      <div className="animate-fade-in">
        <StepIcon icon={Mail01Icon} />
        <h1 className="text-[20px] font-semibold text-text-primary mb-1 tracking-[-0.01em]">
          Set up backup recovery
        </h1>
        <p className="text-[13px] text-text-tertiary leading-relaxed mb-5">
          Paste your 24 words once. We&apos;ll wrap them with a key only you control and email you
          a one time recovery URL to save.
        </p>

        <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-text-disabled mb-1.5">
          Backup email
        </label>
        <input
          ref={inputRef}
          type="email"
          autoComplete="email"
          value={recoveryEmail}
          onChange={(e) => setRecoveryEmail(e.target.value)}
          placeholder="another@example.com"
          maxLength={254}
          className="w-full h-[42px] px-3 rounded-[10px] bg-bg-field border border-transparent text-text-primary text-[14px] placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-text-link/25 focus:border-text-link/40 transition-all mb-4"
        />

        <label className="block text-[10px] font-mono uppercase tracking-[0.16em] text-text-disabled mb-1.5">
          Your 24 word phrase
        </label>
        <textarea
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          rows={4}
          placeholder="word1 word2 word3 …"
          className="w-full px-3 py-2 rounded-[10px] bg-bg-field border border-transparent text-text-primary text-[13px] font-mono placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-text-link/25 focus:border-text-link/40 transition-all resize-none"
        />

        {err && <p className="mt-3 text-[12px] text-accent-red">{err}</p>}

        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setMode("intro")}
            disabled={busy}
            className="text-[13px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer disabled:opacity-50"
          >
            Back
          </button>
          <button
            onClick={handleSubmit}
            disabled={busy}
            className="flex items-center gap-1.5 px-5 h-[40px] rounded-[10px] bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send confirmation"}
            {!busy && <HugeiconsIcon icon={ArrowRight01Icon} size={14} />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <StepIcon icon={Mail01Icon} />
      <h1 className="text-[20px] font-semibold text-text-primary mb-1 tracking-[-0.01em]">
        Add a backup recovery email?
      </h1>
      <p className="text-[13px] text-text-tertiary leading-relaxed mb-3">
        Optional. If you ever lose your 24 word phrase, a backup email gives you a second way
        back in. We never store the part that decrypts. Losing the email loses the backup.
      </p>
      <p className="text-[13px] text-text-tertiary leading-relaxed mb-5">
        You can add or remove this anytime in Settings.
      </p>
      <div className="flex items-center justify-between mt-6">
        <button
          onClick={() => setMode("skip-confirm")}
          className="text-[13px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
        >
          Skip
        </button>
        <button
          onClick={() => setMode("form")}
          className="flex items-center gap-1.5 px-5 h-[40px] rounded-[10px] bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer active:scale-[0.98]"
        >
          Set up
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
        </button>
      </div>
    </div>
  );
}
