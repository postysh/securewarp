"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import Key02Icon from "@hugeicons/core-free-icons/Key02Icon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import {
  enrollPasskey as enrollPasskeyClient,
  passkeyPrfSupported,
} from "@/lib/auth/passkey-client";
import { ConfirmDialog } from "./confirm-dialog";

interface Passkey {
  id: string;
  nickname: string;
  created_at: string;
  last_used_at: string | null;
  transports: string[];
  is_backup_state: boolean;
}

interface Props {
  /** Current TOTP-enabled state from the parent's security panel.
   *  null means "still loading"; we suppress the post-enroll prompt
   *  until we know. */
  totpEnabled: boolean | null;
  /** Called after the user opts to disable TOTP from the post-enroll
   *  prompt — parent must already know the user holds a working
   *  passkey, so it skips the normal "enter your TOTP code to disable"
   *  step (we replace the second factor in one atomic flow). */
  onTotpDisableRequest: () => void;
}

/**
 * Settings → Security card for managing passkeys. Lists enrolled
 * credentials with nickname + last-used + transport hint, lets the
 * user add a new passkey (with a per-credential nickname), and
 * removes credentials with a confirmation.
 *
 * After a successful first-time enrollment AND when TOTP is on, we
 * show the post-enrollment prompt: passkey already counts as two
 * factors, do you want to keep TOTP as a backup or drop it. Default
 * answer is keep — protects against the user fat-fingering "drop"
 * and discovering on next sign-in that their password fallback is
 * single-factor.
 */
export function PasskeysCard({ totpEnabled, onTotpDisableRequest }: Props) {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [postEnrollPromptOpen, setPostEnrollPromptOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Passkey | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/passkey/list");
      if (!res.ok) return;
      const data = await res.json();
      setPasskeys(data.passkeys ?? []);
    } catch {
      /* silent — leave passkeys as null and the UI shows a loading
       * shimmer; not a fatal error path. */
    }
  }, []);

  useEffect(() => {
    void load();
    void passkeyPrfSupported().then(setSupported);
  }, [load]);

  async function handleEnroll() {
    const trimmed = nickname.trim();
    if (!trimmed) {
      setError("Give this passkey a name so you can recognise it later.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const stored = sessionStorage.getItem("securewarp_keys");
      if (!stored) {
        setError("Sign in fully before enrolling a passkey.");
        return;
      }
      const keys = JSON.parse(stored) as {
        encryptionPrivateKey: string;
        kemPrivateKey: string;
      };
      await enrollPasskeyClient({
        nickname: trimmed,
        plaintext: {
          encryptionPrivateKey: keys.encryptionPrivateKey,
          kemPrivateKey: keys.kemPrivateKey,
        },
      });
      setNickname("");
      setAdding(false);
      await load();
      // Only show the keep-vs-drop-TOTP prompt when the user actually
      // has TOTP enabled. Without it the prompt would be confusing
      // ("turn off… what?") and we'd need a different copy.
      if (totpEnabled) {
        setPostEnrollPromptOpen(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enrollment failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!removeTarget) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/passkey/${removeTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Couldn't remove passkey");
        return;
      }
      setRemoveTarget(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  // Browser doesn't support PRF — passkey enrollment isn't safe to
  // offer (no stable wrap key). Render a status row but no enroll
  // button.
  if (supported === false) {
    return (
      <div className="py-4 border-b border-border-tertiary">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center shrink-0">
            <HugeiconsIcon
              icon={Key02Icon}
              size={16}
              color="var(--icon-tertiary)"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-text-primary">Passkeys</p>
            <p className="text-[11px] text-text-disabled mt-0.5">
              This browser doesn&apos;t support the WebAuthn PRF extension yet.
              Try the latest Chrome, Edge, or Safari.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="py-4 border-b border-border-tertiary">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-8 h-8 rounded-[8px] bg-bg-overlay-tertiary flex items-center justify-center shrink-0">
              <HugeiconsIcon
                icon={Key02Icon}
                size={16}
                color="var(--icon-tertiary)"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-text-primary">Passkeys</p>
              <p className="text-[11px] text-text-disabled mt-0.5">
                Sign in with your device&apos;s biometrics or PIN. A passkey
                already counts as two factors.
              </p>
            </div>
          </div>
          {!adding && (
            <button
              onClick={() => {
                setAdding(true);
                setError(null);
              }}
              className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer shrink-0 inline-flex items-center gap-1"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={11} />
              Add a passkey
            </button>
          )}
        </div>

        {/* Inline enrollment row. Browser will pop the platform UI
            (Touch ID / Windows Hello / security-key prompt) once we
            invoke the WebAuthn ceremony. */}
        {adding && (
          <div className="ml-11 mb-3 space-y-2">
            <div>
              <label className="block text-[11px] font-medium text-text-disabled uppercase tracking-wider mb-1.5 font-mono">
                Name this passkey
              </label>
              <p className="text-[11px] text-text-disabled mb-2">
                A label so you can recognise which device this passkey is on,
                like &ldquo;MacBook&rdquo; or &ldquo;Work iPhone&rdquo;.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value.slice(0, 64))}
                placeholder="MacBook, iPhone, YubiKey…"
                disabled={busy}
                autoFocus
                className="flex-1 h-[32px] px-3 rounded-[6px] bg-bg-field border border-border-secondary text-[12px] text-text-primary placeholder:text-text-disabled focus:border-accent-green focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={handleEnroll}
                disabled={busy || !nickname.trim()}
                className="h-[32px] px-3 rounded-[6px] text-[11px] font-medium bg-cta-primary text-text-inverse hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-default"
              >
                {busy ? "Waiting…" : "Continue"}
              </button>
              <button
                onClick={() => {
                  setAdding(false);
                  setNickname("");
                  setError(null);
                }}
                disabled={busy}
                className="h-[32px] px-2 rounded-[6px] text-[11px] text-text-tertiary hover:bg-bg-cell-hover transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="ml-11 mb-2 text-[11px] text-accent-red">{error}</p>
        )}

        {/* Enrolled credentials list. Empty state is implicit — no
            cards rendered. The "Add a passkey" button above is the
            zero-state CTA. */}
        {passkeys && passkeys.length > 0 && (
          <div className="ml-11 space-y-1.5">
            {passkeys.map((pk) => (
              <div
                key={pk.id}
                className="flex items-center justify-between px-3 py-2 rounded-[8px] bg-bg-field border border-border-tertiary"
              >
                <div className="min-w-0 mr-3">
                  <p className="text-[12px] text-text-primary truncate">
                    {pk.nickname}
                  </p>
                  <p className="text-[10px] text-text-disabled mt-0.5">
                    {formatPasskeyMeta(pk)}
                  </p>
                </div>
                <button
                  onClick={() => setRemoveTarget(pk)}
                  className="p-1.5 rounded-[6px] text-icon-tertiary hover:text-accent-red hover:bg-accent-red/10 transition-colors cursor-pointer shrink-0"
                  aria-label={`Remove ${pk.nickname}`}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Post-enrollment prompt: only when the user already had TOTP.
          Default action (Cancel) keeps TOTP — protects against the
          user accidentally weakening their password-fallback path. */}
      <ConfirmDialog
        open={postEnrollPromptOpen}
        title="Passkey added"
        description={
          <>
            <p className="mb-2">
              You can now sign in with your passkey on this device.
            </p>
            <p className="mb-2">
              Your account also has an authenticator app set up. A
              passkey already counts as two factors, so you don&apos;t
              need both.
            </p>
            <p className="text-text-tertiary">
              Keep TOTP on as a backup for password sign in (recommended),
              or turn it off to simplify how you sign in.
            </p>
          </>
        }
        confirmLabel="Turn TOTP off"
        cancelLabel="Keep TOTP on"
        destructive
        onConfirm={() => {
          setPostEnrollPromptOpen(false);
          onTotpDisableRequest();
        }}
        onCancel={() => setPostEnrollPromptOpen(false)}
      />

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove passkey"
        description={
          removeTarget
            ? `Sign in with "${removeTarget.nickname}" will stop working on every device that uses it. You can re-enroll later.`
            : ""
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        destructive
        busy={busy}
        busyLabel="Removing…"
        onConfirm={handleRemove}
        onCancel={() => {
          setRemoveTarget(null);
          setError(null);
        }}
      />
    </>
  );
}

function formatPasskeyMeta(pk: Passkey): string {
  const transport = pickTransport(pk.transports);
  const sync = pk.is_backup_state ? "synced" : "single-device";
  if (pk.last_used_at) {
    const when = new Date(pk.last_used_at).toLocaleDateString();
    return `${transport} · ${sync} · last used ${when}`;
  }
  return `${transport} · ${sync} · never used`;
}

function pickTransport(transports: string[]): string {
  if (transports.includes("internal")) return "Platform";
  if (transports.includes("hybrid")) return "Phone";
  if (transports.includes("usb")) return "Security key";
  if (transports.includes("nfc")) return "NFC key";
  if (transports.includes("ble")) return "Bluetooth key";
  return "Passkey";
}
