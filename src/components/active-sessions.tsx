"use client";

import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import Tablet02Icon from "@hugeicons/core-free-icons/Tablet02Icon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";

/**
 * Settings → Security → Active sessions panel. Lists the caller's
 * own signed-in devices with enough context (parsed UA, country,
 * first-seen + last-seen timestamps, this-device pill) to tell them
 * apart, and lets the caller revoke any one row or every non-current
 * row in a single click.
 *
 * Data comes from /api/auth/sessions (list + revoke-others) and
 * /api/auth/sessions/[jti] (revoke one). Ownership is enforced at
 * the API layer; this component does no privilege checks of its own
 * beyond rendering what the server returns.
 */

interface Session {
  jti: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  country: string | null;
  current: boolean;
}

interface ParsedUA {
  browser: string;
  os: string;
  device: "desktop" | "mobile" | "tablet";
}

/**
 * Lightweight UA parser. Matches the common signatures from
 * Chrome / Safari / Firefox / Edge / Opera on macOS / Windows /
 * iOS / iPadOS / Android / Linux. Produces strings like "Chrome 131
 * on macOS 14" — a specific-enough fingerprint that two laptops
 * with different Chrome versions are visually distinguishable. We
 * don't import a full UA library (~30 KB) — the cases we care
 * about are tractable and everything else falls through to the raw
 * UA head so the user still sees something.
 */
function parseUserAgent(ua: string | null): ParsedUA {
  if (!ua) return { browser: "Unknown browser", os: "Unknown OS", device: "desktop" };
  const s = ua;

  // Device inference
  let device: ParsedUA["device"] = "desktop";
  if (/\bMobile\b/i.test(s) || /iPhone/i.test(s) || /\bAndroid\b/i.test(s)) device = "mobile";
  if (/iPad/i.test(s) || /Tablet/i.test(s)) device = "tablet";

  // Browser detection — order matters because Chrome appears in
  // many non-Chrome UAs. Edge/Opera must come before Chrome/Safari.
  let browser = "Unknown browser";
  const edgeM = /Edg\/(\d+)/i.exec(s);
  const operaM = /OPR\/(\d+)/i.exec(s);
  const firefoxM = /Firefox\/(\d+)/i.exec(s);
  const chromeM = /Chrome\/(\d+)/i.exec(s);
  const safariM = /Version\/(\d+).*Safari/i.exec(s);
  if (edgeM) browser = `Edge ${edgeM[1]}`;
  else if (operaM) browser = `Opera ${operaM[1]}`;
  else if (firefoxM) browser = `Firefox ${firefoxM[1]}`;
  else if (chromeM) browser = `Chrome ${chromeM[1]}`;
  else if (safariM) browser = `Safari ${safariM[1]}`;
  else if (s.length > 0) browser = s.slice(0, 40);

  // OS detection
  let os = "Unknown OS";
  const macM = /Mac OS X (\d+[_.]\d+)/i.exec(s);
  const winM = /Windows NT (\d+\.\d+)/i.exec(s);
  const iosM = /OS (\d+[_.]\d+) like Mac OS X/i.exec(s);
  const androidM = /Android (\d+(?:\.\d+)?)/i.exec(s);
  if (iosM) os = `iOS ${iosM[1].replace("_", ".")}`;
  else if (macM) {
    // e.g. "10_15_7" or "14.0"; show just the major version.
    const major = macM[1].split(/[_.]/)[0];
    os = major === "10" ? "macOS" : `macOS ${major}`;
  }
  else if (winM) os = `Windows ${winM[1] === "10.0" ? "10/11" : winM[1]}`;
  else if (androidM) os = `Android ${androidM[1]}`;
  else if (/Linux/i.test(s)) os = "Linux";

  return { browser, os, device };
}

/**
 * ISO-3166-1 alpha-2 → regional-indicator emoji flag. Unicode
 * regional indicators are code points U+1F1E6 (A) through U+1F1FF
 * (Z); two consecutive ones render as a flag glyph.
 */
function countryFlag(code: string | null): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "";
  const base = 0x1f1e6; // regional indicator A
  const a = code.charCodeAt(0) - 65;
  const b = code.charCodeAt(1) - 65;
  return String.fromCodePoint(base + a, base + b);
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 45) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  // Fall through to a short date. Passed 2 weeks, relative
  // framing stops being informative.
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function DeviceIcon({ device }: { device: ParsedUA["device"] }) {
  const icon = device === "mobile" ? SmartPhone01Icon : device === "tablet" ? Tablet02Icon : ComputerIcon;
  return <HugeiconsIcon icon={icon} size={15} color="var(--icon-tertiary)" strokeWidth={1.8} />;
}

export function ActiveSessions() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyJti, setBusyJti] = useState<string | null>(null);
  const [revokeOthersBusy, setRevokeOthersBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/sessions", { credentials: "same-origin" });
      if (!res.ok) {
        setError("Failed to load sessions.");
        return;
      }
      const data = (await res.json()) as { sessions: Session[] };
      setSessions(data.sessions);
      setError(null);
    } catch {
      setError("Failed to load sessions.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revokeOne = async (s: Session) => {
    if (busyJti) return;
    setBusyJti(s.jti);
    try {
      const res = await fetch(`/api/auth/sessions/${s.jti}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        setError("Failed to revoke session.");
        return;
      }
      if (s.current) {
        // Revoking the current session logs the caller out. Send
        // them back to /login so they don't see a half-broken
        // dashboard.
        window.location.href = "/login";
        return;
      }
      setSessions((prev) => prev?.filter((x) => x.jti !== s.jti) ?? null);
    } finally {
      setBusyJti(null);
    }
  };

  const revokeOthers = async () => {
    if (revokeOthersBusy) return;
    setRevokeOthersBusy(true);
    try {
      const res = await fetch("/api/auth/sessions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke-others" }),
      });
      if (!res.ok) {
        setError("Failed to revoke other sessions.");
        return;
      }
      setSessions((prev) => prev?.filter((x) => x.current) ?? null);
    } finally {
      setRevokeOthersBusy(false);
    }
  };

  const otherCount = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <div className="py-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] text-text-primary">Active sessions</p>
          <p className="text-[11px] text-text-disabled mt-0.5">
            Devices currently signed in with your account. Revoke any you do not recognize.
          </p>
        </div>
        {otherCount > 0 && (
          <button
            onClick={revokeOthers}
            disabled={revokeOthersBusy}
            className="h-[28px] px-3 rounded-[6px] text-[11px] font-medium text-text-secondary hover:bg-bg-cell-hover border border-border-secondary transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            {revokeOthersBusy ? "Revoking…" : "Sign out others"}
          </button>
        )}
      </div>

      {error && (
        <p className="text-[11px] text-accent-red">{error}</p>
      )}

      {sessions === null && !error && (
        <p className="text-[11px] text-text-disabled">Loading…</p>
      )}

      {sessions && sessions.length === 0 && (
        <p className="text-[11px] text-text-disabled">No active sessions.</p>
      )}

      {sessions && sessions.length > 0 && (
        /* Cap the list height at ~6 rows — around 320 px given
           the row's h-[52 px] + 1 px border. Beyond that we
           overflow-scroll inside the panel so the list doesn't
           push the rest of the Security tab content off-screen.
           scrollbar-gutter keeps the scrollbar from shifting the
           row layout once it appears on the 7th row. */
        <div
          className="rounded-[10px] border border-border-tertiary overflow-y-auto overflow-x-hidden"
          style={{ maxHeight: 320, scrollbarGutter: "stable" }}
        >
          {sessions.map((s) => {
            const ua = parseUserAgent(s.userAgent);
            const flag = countryFlag(s.country);
            return (
              <div
                key={s.jti}
                className="flex items-center gap-3 px-3 py-2.5 border-b border-border-tertiary last:border-b-0"
              >
                <div className="w-8 h-8 rounded-md bg-bg-side border border-border-tertiary flex items-center justify-center shrink-0">
                  <DeviceIcon device={ua.device} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[12px] text-text-primary">
                      {ua.browser} on {ua.os}
                    </span>
                    {s.current && (
                      <span
                        className="text-[9px] font-mono font-semibold tracking-wider px-1.5 py-0.5 rounded"
                        style={{
                          background: "rgba(239,90,60,0.12)",
                          color: "rgba(239,90,60,0.95)",
                          border: "1px solid rgba(239,90,60,0.25)",
                          lineHeight: 1,
                        }}
                      >
                        THIS DEVICE
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-text-disabled mt-0.5 truncate">
                    {flag && <span className="mr-1.5">{flag}</span>}
                    {s.country ?? "Unknown location"}
                    <span className="mx-1.5">·</span>
                    Signed in {formatRelative(s.createdAt)}
                    <span className="mx-1.5">·</span>
                    Last active {formatRelative(s.lastSeenAt)}
                  </p>
                </div>
                <button
                  onClick={() => revokeOne(s)}
                  disabled={busyJti === s.jti}
                  className="h-[26px] px-2.5 rounded-[6px] text-[11px] font-medium text-accent-red hover:bg-accent-red/10 border border-accent-red/25 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {busyJti === s.jti ? "…" : s.current ? "Sign out" : "Revoke"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-1.5 text-[10px] text-text-disabled">
        <HugeiconsIcon icon={Shield01Icon} size={11} color="var(--icon-tertiary)" strokeWidth={1.8} className="mt-0.5 shrink-0" />
        <span>
          Revoking a session signs that device out on the next request. Your private keys stay encrypted on that device&apos;s disk until the user manually clears them.
        </span>
      </div>
    </div>
  );
}
