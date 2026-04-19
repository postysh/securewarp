"use client";

import { useState } from "react";
import { FloatingParticles } from "@/components/floating-particles";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import {
  SECTION_MAX,
  SECTION_PAD_Y,
  EYEBROW_STYLE,
  H2_STYLE,
} from "@/lib/marketing-style";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

export default function Support() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.kind === "submitting") return;
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/support/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, subject, message }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Something went wrong." }));
        setState({ kind: "error", message: body.error || "Something went wrong." });
        return;
      }
      setState({ kind: "ok" });
      setEmail("");
      setName("");
      setSubject("");
      setMessage("");
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  };

  return (
    <div
      style={{
        fontFamily: "var(--font-chillax), var(--font-geist-sans), system-ui, sans-serif",
        background: "#111",
        minHeight: "100vh",
        position: "relative",
      }}
    >
      <FloatingParticles count={60} />
      <MarketingNav current="support" />

      <section
        style={{
          padding: "140px 32px 0",
          maxWidth: SECTION_MAX,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <span style={EYEBROW_STYLE}>Get in touch</span>
          <h1 style={{ ...H2_STYLE, fontSize: "clamp(32px, 4.2vw, 48px)", margin: "0 0 18px" }}>
            Questions, bug reports,
            <br />
            or anything else.
          </h1>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.55)",
              margin: "0 auto",
              maxWidth: 520,
              textWrap: "pretty",
            }}
          >
            Real humans read every message. We usually reply within a day or
            two. If it&apos;s a security concern, put &quot;security&quot; in the subject and
            we&apos;ll bump it to the top.
          </p>
        </div>
      </section>

      <section
        style={{
          padding: `${SECTION_PAD_Y}px 32px 64px`,
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <form
          onSubmit={submit}
          style={{
            background: "#1a1a1a",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: "32px",
          }}
        >
          <Field label="Your name" optional>
            <Input
              value={name}
              onChange={setName}
              placeholder="Optional"
              autoComplete="name"
              maxLength={120}
            />
          </Field>

          <Field label="Your email">
            <Input
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              required
              autoComplete="email"
              maxLength={254}
            />
          </Field>

          <Field label="Subject">
            <Input
              value={subject}
              onChange={setSubject}
              placeholder="What's on your mind?"
              required
              maxLength={200}
            />
          </Field>

          <Field label="Message">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Give us as much detail as you can."
              required
              maxLength={4000}
              rows={7}
              style={inputBaseStyle({ multiline: true })}
            />
            <div
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.35)",
                textAlign: "right",
                marginTop: 6,
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              {message.length} / 4000
            </div>
          </Field>

          {state.kind === "error" && (
            <div
              role="alert"
              style={{
                marginBottom: 18,
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(232,93,48,0.08)",
                border: "1px solid rgba(232,93,48,0.3)",
                color: "rgba(255,180,160,0.9)",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {state.message}
            </div>
          )}

          {state.kind === "ok" ? (
            <div
              role="status"
              style={{
                padding: "16px 18px",
                borderRadius: 10,
                background: "rgba(110,210,170,0.08)",
                border: "1px solid rgba(110,210,170,0.3)",
                color: "rgba(190,240,215,0.95)",
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Message sent.</div>
              We&apos;ll reply to the email address you provided within a day or two.
              Check your inbox for a confirmation.
            </div>
          ) : (
            <button
              type="submit"
              disabled={state.kind === "submitting"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "12px 24px",
                fontSize: 14,
                fontWeight: 500,
                color: "#111",
                background: "white",
                borderRadius: 10,
                border: "none",
                cursor: state.kind === "submitting" ? "default" : "pointer",
                opacity: state.kind === "submitting" ? 0.6 : 1,
                transition: "opacity 160ms ease",
                fontFamily: "inherit",
              }}
            >
              {state.kind === "submitting" ? "Sending..." : "Send message"}
            </button>
          )}
        </form>

        <p
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.4)",
            lineHeight: 1.6,
            marginTop: 24,
            textAlign: "center",
          }}
        >
          Or email us directly at{" "}
          <a
            href="mailto:hello@securewarp.com"
            style={{ color: "rgba(110,210,170,0.9)", textDecoration: "none" }}
          >
            hello@securewarp.com
          </a>
          .
        </p>
      </section>

      <MarketingFooter />
    </div>
  );
}

// ── Form primitives ────────────────────────────────────────────────

function Field({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontSize: 11,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: 1.5,
          color: "rgba(255,255,255,0.45)",
          marginBottom: 8,
        }}
      >
        <span>{label}</span>
        {optional && (
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>Optional</span>
        )}
      </label>
      {children}
    </div>
  );
}

function inputBaseStyle(opts: { multiline?: boolean } = {}): React.CSSProperties {
  return {
    width: "100%",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: "12px 14px",
    fontSize: 14,
    color: "white",
    outline: "none",
    fontFamily: "inherit",
    resize: opts.multiline ? "vertical" : "none",
    lineHeight: opts.multiline ? 1.55 : undefined,
  };
}

function Input(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
}) {
  return (
    <input
      type={props.type || "text"}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      required={props.required}
      autoComplete={props.autoComplete}
      maxLength={props.maxLength}
      style={inputBaseStyle()}
    />
  );
}
