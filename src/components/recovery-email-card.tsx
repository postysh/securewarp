"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import AlertCircleIcon from "@hugeicons/core-free-icons/AlertCircleIcon";
import { ConfirmDialog } from "./confirm-dialog";

interface Status {
  recoveryEmail: string | null;
  verifiedAt: string | null;
}

/**
 * Settings-pane card for managing recovery-email backup. Mirrors the
 * onboarding wizard's StepRecoveryEmail but stripped down — surfaces
 * status (none / pending / active), a setup form (email + phrase
 * paste), a "send confirmation again" prompt for the pending state,
 * and a Remove action for the active state.
 */
export function RecoveryEmailCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [editing, setEditing] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/recovery-email");
      if (!res.ok) return;
      const data = await res.json();
      setStatus({
        recoveryEmail: data.recoveryEmail ?? null,
        verifiedAt: data.verifiedAt ?? null,
      });
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    setErr(null);
    const email = recoveryEmail.trim().toLowerCase();
    if (!email) {
      setErr("Enter a recovery email.");
      return;
    }
    const cryptoMod = await import("@/lib/auth/recovery-email-crypto");
    let cleaned: string;
    try {
      cleaned = cryptoMod.cleanAndValidateMnemonic(phrase);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Phrase doesn't look right.");
      return;
    }
    setBusy(true);
    try {
      const { hashRecoveryKey } = await import("@/lib/crypto/keys");
      const wrap = await cryptoMod.wrapMnemonicForEmail(cleaned);
      const recoveryKeyHash = await hashRecoveryKey(cleaned);
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
      setSent(true);
      setPhrase("");
      setEditing(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/recovery-email", { method: "DELETE" });
      if (!res.ok) throw new Error();
      setSent(false);
      await load();
    } catch {
      setErr("Couldn't remove. Try again.");
    } finally {
      setBusy(false);
      setConfirmRemoveOpen(false);
    }
  }

  const isActive = !!status?.recoveryEmail && !!status?.verifiedAt;
  const isPending = !!status?.recoveryEmail && !status?.verifiedAt;
  const stateLabel = isActive ? "Active" : isPending ? "Pending" : "Off";
  const stateColor = isActive
    ? "var(--accent-green-primary)"
    : isPending
    ? "var(--accent-yellow-primary)"
    : "var(--text-disabled)";

  return (
    <div className="py-3 space-y-3">
      {/* Header — title + description on the left, primary action on the right.
          Mirrors the layout used by ActiveSessions so the two
          sections sit next to each other with the same rhythm. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] text-text-primary">Backup recovery email</p>
            <span
              className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.14em] px-1.5 py-0.5 rounded border"
              style={{
                color: stateColor,
                borderColor: `color-mix(in srgb, ${stateColor} 35%, transparent)`,
                background: `color-mix(in srgb, ${stateColor} 10%, transparent)`,
                lineHeight: 1,
              }}
            >
              <span
                aria-hidden
                className="w-[5px] h-[5px] rounded-full"
                style={{ background: stateColor }}
              />
              {stateLabel}
            </span>
          </div>
          <p className="text-[11px] text-text-disabled mt-0.5">
            Optional second path back into your account if you lose your 24 word phrase.
          </p>
        </div>
        {!editing && (
          <div className="flex items-center gap-1.5 shrink-0">
            {isActive || isPending ? (
              <>
                <button
                  onClick={() => {
                    setRecoveryEmail("");
                    setPhrase("");
                    setSent(false);
                    setErr(null);
                    setEditing(true);
                  }}
                  disabled={busy}
                  className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  Replace
                </button>
                <button
                  onClick={() => setConfirmRemoveOpen(true)}
                  disabled={busy}
                  className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-accent-red hover:bg-accent-red/10 border border-accent-red/25 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  Remove
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setRecoveryEmail("");
                  setPhrase("");
                  setSent(false);
                  setErr(null);
                  setEditing(true);
                }}
                className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap"
              >
                Set up
              </button>
            )}
          </div>
        )}
      </div>

      {sent && !editing && (
        <p className="text-[11px] text-accent-green">
          Check your inbox. Confirmation email sent.
        </p>
      )}

      {/* Current value row — only when something is configured.
          Matches the "rounded-[10px] border" container the
          sessions list uses, but kept short (a single row). */}
      {status?.recoveryEmail && !editing && (
        <div className="rounded-[10px] border border-border-tertiary px-3 py-2.5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-bg-side border border-border-tertiary flex items-center justify-center shrink-0">
            <HugeiconsIcon
              icon={isActive ? Tick01Icon : AlertCircleIcon}
              size={14}
              color={isActive ? "var(--accent-green-primary)" : "var(--accent-yellow-primary)"}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] text-text-primary truncate">{status.recoveryEmail}</p>
            <p className="text-[10px] text-text-disabled mt-0.5">
              {isActive
                ? "Confirmed and ready"
                : "Awaiting confirmation. Check the inbox for the link."}
            </p>
          </div>
        </div>
      )}

      {/* Inline editor — same border treatment as the value row,
          so opening it feels like the row is expanding instead of
          spawning a separate panel. */}
      {editing && (
        <div className="rounded-[10px] border border-border-tertiary p-3 space-y-3">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-[0.14em] text-text-disabled mb-1.5">
              Backup email
            </label>
            <input
              type="email"
              value={recoveryEmail}
              onChange={(e) => setRecoveryEmail(e.target.value)}
              placeholder="another@example.com"
              maxLength={254}
              className="w-full h-[32px] px-3 rounded-[6px] bg-bg-field text-[12px] text-text-primary placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-[0.14em] text-text-disabled mb-1.5">
              Your 24 word phrase
            </label>
            <textarea
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              rows={3}
              placeholder="word1 word2 word3 …"
              className="w-full px-3 py-2 rounded-[6px] bg-bg-field text-[12px] text-text-primary font-mono placeholder:text-text-disabled border border-transparent focus:border-border-primary focus:outline-none resize-none"
            />
            <p className="text-[10px] text-text-disabled mt-1">
              Pasted once. We wrap it locally and email you a one time recovery URL.
            </p>
          </div>
          {err && (
            <p className="text-[11px] text-accent-red leading-relaxed">{err}</p>
          )}
          <div className="flex items-center justify-end gap-1.5 pt-1">
            <button
              onClick={() => setEditing(false)}
              disabled={busy}
              className="h-[28px] px-3 rounded-[6px] text-[11px] text-text-secondary hover:bg-bg-cell-hover transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-inverse bg-cta-primary hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              {busy ? "Sending…" : "Send confirmation"}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmRemoveOpen}
        title="Remove backup recovery email?"
        description={
          <>
            <p>
              Your 24 word phrase will be the only way back into your account if you forget your
              password.
            </p>
            <p className="mt-2">
              The recovery URL we previously emailed will stop working immediately.
            </p>
          </>
        }
        confirmLabel="Remove"
        destructive
        busy={busy}
        busyLabel="Removing…"
        onConfirm={remove}
        onCancel={() => !busy && setConfirmRemoveOpen(false)}
      />
    </div>
  );
}
