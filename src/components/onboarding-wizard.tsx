"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import UserIcon from "@hugeicons/core-free-icons/UserIcon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import Sun01Icon from "@hugeicons/core-free-icons/Sun01Icon";
import Moon02Icon from "@hugeicons/core-free-icons/Moon02Icon";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import { useTheme } from "./theme-provider";

type Step = "name" | "workspace" | "done";

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
    setBusy(true);
    await completeOnboarding();
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

      await completeOnboarding();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setBusy(false);
    }
  }

  if (!ready) return <div className="h-full bg-bg-side" />;

  const stepIndex = step === "name" ? 0 : step === "workspace" ? 1 : 2;

  return (
    <div className="h-full flex items-center justify-center bg-bg-side p-4 relative">
      <button
        onClick={toggle}
        className="absolute top-5 right-5 p-2 rounded-[6px] text-icon-tertiary hover:bg-cta-nav-hover transition-colors cursor-pointer z-10"
      >
        <HugeiconsIcon icon={theme === "dark" ? Sun01Icon : Moon02Icon} size={16} />
      </button>

      <div
        className="w-full max-w-[480px] rounded-2xl border border-border-tertiary bg-bg-main p-10"
        style={{ boxShadow: "var(--shadow-l2)" }}
      >
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg bg-accent-green flex items-center justify-center">
            <HugeiconsIcon icon={Shield01Icon} size={16} color="white" />
          </div>
          <span className="font-semibold text-[15px] text-text-primary">SecureWarp</span>
        </div>

        <div className="flex items-center gap-2 mb-6">
          {[0, 1].map((i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= stepIndex ? "bg-accent-green" : "bg-bg-field"
              }`}
            />
          ))}
        </div>

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
      </div>
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
      <div className="flex items-center gap-2 mb-2 text-text-tertiary">
        <HugeiconsIcon icon={UserIcon} size={14} />
        <span className="text-[11px] font-mono uppercase tracking-wide">Step 1 of 2</span>
      </div>
      <h1 className="text-[22px] font-semibold text-text-primary mb-2 tracking-[-0.01em]">
        What should we call you?
      </h1>
      <p className="text-[13px] text-text-tertiary leading-relaxed mb-6">
        Your display name is shown when you share files with teammates. Just
        this, we can't see anything else about you.
      </p>

      <input
        ref={inputRef}
        type="text"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !busy) onNext(); }}
        placeholder="Your name"
        maxLength={100}
        className="w-full h-[42px] px-3 rounded-[8px] bg-bg-field border border-border-tertiary text-text-primary text-[14px] placeholder:text-text-disabled focus:outline-none focus:border-accent-green transition-colors"
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
          className="flex items-center gap-1.5 px-4 h-[38px] rounded-[8px] bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
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
      <div className="flex items-center gap-2 mb-2 text-text-tertiary">
        <HugeiconsIcon icon={UserGroupIcon} size={14} />
        <span className="text-[11px] font-mono uppercase tracking-wide">Step 2 of 2</span>
      </div>
      <h1 className="text-[22px] font-semibold text-text-primary mb-2 tracking-[-0.01em]">
        Collaborating with a team?
      </h1>
      <p className="text-[13px] text-text-tertiary leading-relaxed mb-6">
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
        className="w-full h-[42px] px-3 rounded-[8px] bg-bg-field border border-border-tertiary text-text-primary text-[14px] placeholder:text-text-disabled focus:outline-none focus:border-accent-green transition-colors"
      />

      {error && <p className="mt-3 text-[12px] text-accent-red">{error}</p>}

      <div className="flex items-center justify-between mt-6">
        <button
          onClick={onSkip}
          disabled={busy}
          className="text-[13px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer disabled:opacity-50"
        >
          Skip, I'll do this later
        </button>
        <button
          onClick={onCreate}
          disabled={busy || !workspaceName.trim()}
          className="flex items-center gap-1.5 px-4 h-[38px] rounded-[8px] bg-cta-primary text-text-inverse text-[13px] font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
        >
          {busy ? "Creating..." : "Create workspace"}
          {!busy && <HugeiconsIcon icon={Tick01Icon} size={14} />}
        </button>
      </div>
    </div>
  );
}
