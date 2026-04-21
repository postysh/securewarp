"use client";

import { useState } from "react";

import {
  TEXT,
  TEXT_MUTED,
  BORDER,
  GREEN,
  BRAND_SANS,
  BRAND_MONO,
} from "@/components/marketing-shell";

/**
 * "Send test" control for /dev/emails/[template]. Posts to the
 * admin-gated /api/dev/send-email endpoint with the shared fixture
 * data. Remembers the last address used in localStorage so you can
 * blast every template in a row without retyping.
 */
export function SendTestButton({ template }: { template: string }) {
  const [to, setTo] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return localStorage.getItem("dev:email-test-to") ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "ok"; msg: string }
    | { kind: "err"; msg: string }
  >({ kind: "idle" });

  const send = async () => {
    const addr = to.trim();
    if (!addr || !addr.includes("@")) {
      setStatus({ kind: "err", msg: "Enter a valid email address." });
      return;
    }
    try {
      localStorage.setItem("dev:email-test-to", addr);
    } catch {
      /* ignore quota / private mode */
    }
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const res = await fetch("/api/dev/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, to: addr }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        devNoOp?: boolean;
        providerMessageId?: string | null;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        setStatus({ kind: "err", msg: body.error ?? `HTTP ${res.status}` });
        return;
      }
      if (body.devNoOp) {
        setStatus({
          kind: "ok",
          msg: "Sent (dev no-op — RESEND_API_KEY unset). Check server logs for the template summary.",
        });
      } else {
        setStatus({
          kind: "ok",
          msg: body.providerMessageId
            ? `Sent to ${addr} (${body.providerMessageId}).`
            : `Sent to ${addr}.`,
        });
      }
    } catch (err) {
      setStatus({
        kind: "err",
        msg: err instanceof Error ? err.message : "Request failed",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: 16,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 240 }}>
        <p
          style={{
            margin: "0 0 6px",
            fontSize: 10,
            fontFamily: BRAND_MONO,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: TEXT_MUTED,
          }}
        >
          Send test to
        </p>
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="you@example.com"
          disabled={busy}
          style={{
            width: "100%",
            padding: "8px 12px",
            fontSize: 13,
            fontFamily: BRAND_SANS,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            background: "#fff",
            color: TEXT,
            outline: "none",
          }}
        />
      </div>
      <button
        type="button"
        onClick={send}
        disabled={busy}
        style={{
          padding: "10px 18px",
          fontSize: 11,
          fontFamily: BRAND_MONO,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontWeight: 500,
          background: GREEN,
          color: "#fff",
          border: "none",
          borderRadius: 8,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Sending…" : "Send test →"}
      </button>
      {status.kind !== "idle" && (
        <p
          style={{
            flexBasis: "100%",
            margin: "4px 0 0",
            fontSize: 12,
            fontFamily: BRAND_SANS,
            color: status.kind === "ok" ? "#047857" : "#b91c1c",
          }}
        >
          {status.msg}
        </p>
      )}
    </div>
  );
}
