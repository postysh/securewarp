"use client";

import Link from "next/link";
import { FloatingParticles } from "@/components/floating-particles";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import {
  SECTION_MAX,
  SECTION_PAD_Y,
  EYEBROW_STYLE,
  H2_STYLE,
} from "@/lib/marketing-style";
import { HugeiconsIcon } from "@hugeicons/react";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import Key01Icon from "@hugeicons/core-free-icons/Key01Icon";

export default function About() {
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
      <MarketingNav current="about" />

      {/* Hero */}
      <section
        style={{
          padding: "140px 32px 0",
          maxWidth: SECTION_MAX,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <span style={EYEBROW_STYLE}>About SecureWarp</span>

          <h1 style={{ ...H2_STYLE, fontSize: "clamp(32px, 4.2vw, 48px)", margin: "0 0 18px" }}>
            Privacy isn&apos;t a feature.
            <br />
            It&apos;s the default.
          </h1>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.55)",
              margin: "0 auto",
              maxWidth: 560,
              textWrap: "pretty",
            }}
          >
            SecureWarp is a cloud drive for people who expect their files to
            stay theirs. Every byte is encrypted in your browser before it
            leaves your device. The server stores ciphertext. Nobody, not even
            us, can read it.
          </p>
        </div>
      </section>

      {/* Principles */}
      <section
        style={{
          padding: `${SECTION_PAD_Y}px 32px`,
          maxWidth: SECTION_MAX,
          margin: "0 auto",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 48px" }}>
          <span style={EYEBROW_STYLE}>What we believe</span>
          <h2 style={H2_STYLE}>Three principles we design around.</h2>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 20,
          }}
        >
          {[
            {
              icon: Shield01Icon,
              accent: "rgba(110,210,170,0.85)",
              eyebrow: "Hostile by default",
              title: "Assume the server is compromised.",
              body:
                "Instead of promising not to peek, we build so peeking is impossible. Every file is encrypted before upload. A database leak, a rogue employee, a subpoena. None of them reveal your content.",
            },
            {
              icon: LockIcon,
              accent: "rgb(120,150,220)",
              eyebrow: "No metadata laundering",
              title: "Honest about what we can see.",
              body:
                "Some things have to cross the wire: file sizes, timestamps, who shares with whom. We list them plainly on the landing page instead of hiding them in fine print. What we can't see stays unseeable.",
            },
            {
              icon: Key01Icon,
              accent: "rgb(225,140,110)",
              eyebrow: "You own your keys",
              title: "Lose your password, lose your files.",
              body:
                "That sounds harsh. It's the point. A recovery phrase is your second chance. There is no master key, no admin override, no support ticket that rebuilds your data. Your privacy depends on that.",
            },
          ].map((card) => (
            <div
              key={card.title}
              style={{
                background: "#1a1a1a",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 16,
                padding: "28px 26px",
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.04)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <HugeiconsIcon icon={card.icon} size={20} color={card.accent} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-geist-mono), monospace",
                    textTransform: "uppercase",
                    letterSpacing: 1.5,
                    color: "rgba(255,255,255,0.4)",
                    marginBottom: 10,
                  }}
                >
                  {card.eyebrow}
                </div>
                <h3
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    color: "white",
                    letterSpacing: -0.3,
                    margin: "0 0 10px",
                    lineHeight: 1.25,
                  }}
                >
                  {card.title}
                </h3>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,0.5)", margin: 0 }}>
                  {card.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Why we built it */}
      <section
        style={{
          padding: `${SECTION_PAD_Y}px 32px`,
          maxWidth: SECTION_MAX,
          margin: "0 auto",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 40px" }}>
          <span style={EYEBROW_STYLE}>Why we exist</span>
          <h2 style={H2_STYLE}>The modern cloud wasn&apos;t built for privacy.</h2>
        </div>
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            fontSize: 16,
            lineHeight: 1.75,
            color: "rgba(255,255,255,0.6)",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            textWrap: "pretty",
          }}
        >
          <p>
            Most cloud providers promise privacy. Their business models require
            reading your data. Search, sharing, thumbnails, previews, AI summaries:
            every feature pressures the provider to look inside your files.
          </p>
          <p>
            SecureWarp is a different shape. Every convenience (search, preview,
            share links, team workspaces) runs client side, on your device, with
            the server holding only opaque ciphertext. We never had to choose
            between a great UX and actually private storage, because we never
            let the server see your content in the first place.
          </p>
          <p>
            The result is a drive that works like Google Drive and protects your
            files like a password manager. No master key we could hand over. No
            content the server could lose. No surprise in the terms of service.
          </p>
        </div>
      </section>

      {/* Who's behind it */}
      <section
        style={{
          padding: `${SECTION_PAD_Y}px 32px`,
          maxWidth: SECTION_MAX,
          margin: "0 auto",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 40px" }}>
          <span style={EYEBROW_STYLE}>Who&apos;s behind it</span>
          <h2 style={H2_STYLE}>Small team. Honest work.</h2>
        </div>
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            background: "#1a1a1a",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 16,
            padding: "28px 32px",
            fontSize: 15,
            lineHeight: 1.7,
            color: "rgba(255,255,255,0.6)",
            textWrap: "pretty",
          }}
        >
          <p style={{ margin: "0 0 14px" }}>
            SecureWarp is built by a small independent team. No ads. No
            selling anything about what you store. No investors pushing us
            to look at your data.
          </p>
          <p style={{ margin: 0 }}>
            Zero knowledge isn&apos;t a promise. It&apos;s how the app is
            put together. Every file is encrypted in your browser before
            upload, and our servers only hold ciphertext. We can&apos;t hand
            over what we can&apos;t read.
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 20,
              paddingTop: 18,
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {[
              "XSalsa20-Poly1305",
              "Argon2id",
              "SRP-6a",
              "BIP39",
              "HKDF-SHA256",
              "nacl.box / nacl.secretbox",
            ].map((p) => (
              <span
                key={p}
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-geist-mono), monospace",
                  letterSpacing: 0.8,
                  color: "rgba(255,255,255,0.55)",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  padding: "4px 10px",
                  borderRadius: 6,
                }}
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section
        style={{
          padding: `${SECTION_PAD_Y}px 32px 64px`,
          maxWidth: SECTION_MAX,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <h2 style={H2_STYLE}>Ready when you are.</h2>
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.6,
              color: "rgba(255,255,255,0.5)",
              margin: "16px auto 28px",
              maxWidth: 480,
            }}
          >
            Free while in beta. 20 GB included. No credit card. No content we
            could hand over even if someone asked.
          </p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
            <Link
              href="/signup"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 22px",
                fontSize: 14,
                fontWeight: 500,
                color: "#111",
                background: "white",
                borderRadius: 10,
                textDecoration: "none",
              }}
            >
              Get Started
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <Link
              href="/"
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.5)",
                textDecoration: "none",
              }}
            >
              ← Back home
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
