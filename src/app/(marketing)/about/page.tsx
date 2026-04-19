"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import Key01Icon from "@hugeicons/core-free-icons/Key01Icon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";

import {
  MarketingShell,
  TEXT,
  TEXT_MUTED,
  BORDER,
  GREEN,
  BRAND_SANS,
  BRAND_MONO,
} from "@/components/marketing-shell";

/**
 * About page — /about. Mirrors the Gately-pattern mockup
 * layout (MarketingShell + centered hero + numbered / framed sections
 * + final CTA) with content lifted from src/app/(marketing)/about.
 */
export default function MockupAbout() {
  return (
    <MarketingShell>
      <HeroBlock />
      <DottedSpacer />
      <PrinciplesBlock />
      <DottedSpacer />
      <WhyBlock />
      <DottedSpacer />
      <TeamBlock />
      <DottedSpacer />
      <FinalCtaBlock />
    </MarketingShell>
  );
}

// Thin reuse of the DotDivider visual via the shell's export is
// overkill here — we just want the hairline-flanked pattern band
// between sections, not the full divider (which MarketingShell already
// adds near the footer). So re-inline the same 72px strip here.
function DottedSpacer() {
  return (
    <div
      aria-hidden
      style={{
        height: 72,
        borderTop: `1px solid ${BORDER}`,
        borderBottom: `1px solid ${BORDER}`,
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='12' cy='12' r='1' fill='%23000' fill-opacity='0.1'/></svg>\")",
        backgroundSize: "24px 24px",
      }}
    />
  );
}

function HeroBlock() {
  return (
    <section
      style={{
        padding: "96px 32px 64px",
        textAlign: "center",
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: GREEN,
          fontFamily: BRAND_MONO,
        }}
      >
        About SecureWarp
      </span>
      <h1
        style={{
          marginTop: 12,
          fontSize: "clamp(2.5rem, 5vw, 3.5rem)",
          lineHeight: 1.05,
          color: TEXT,
          fontFamily: BRAND_SANS,
          fontWeight: 400,
          letterSpacing: -1,
          margin: "12px auto 20px",
          maxWidth: 720,
        }}
      >
        Privacy isn&apos;t a feature. It&apos;s the{" "}
        <span style={{ color: GREEN }}>default</span>.
      </h1>
      <p
        style={{
          fontSize: 17,
          lineHeight: 1.6,
          maxWidth: 560,
          margin: "0 auto",
          color: TEXT_MUTED,
          fontFamily: BRAND_SANS,
          // `text-wrap: pretty` lets the browser rebalance the last
          // two lines so a single word (here "it") can't end up
          // orphaned on its own line.
          textWrap: "pretty",
        }}
      >
        SecureWarp is a cloud drive for people who expect their files to stay
        theirs. Every byte is encrypted in your browser before it leaves your
        device. The server stores ciphertext. Nobody, not even us, can read
        it.
      </p>
    </section>
  );
}

function PrinciplesBlock() {
  const principles: Array<{
    icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
    eyebrow: string;
    title: string;
    body: string;
  }> = [
    {
      icon: Shield01Icon,
      eyebrow: "Hostile by default",
      title: "Assume the server is compromised.",
      body:
        "Instead of promising not to peek, we build so peeking is impossible. Every file is encrypted before upload. A database leak, a rogue employee, a subpoena, none of them reveal your content.",
    },
    {
      icon: LockIcon,
      eyebrow: "No metadata laundering",
      title: "Honest about what we can see.",
      body:
        "Some things have to cross the wire: file sizes, timestamps, who shares with whom. We list them plainly on the landing page instead of hiding them in fine print. What we can't see stays unseeable.",
    },
    {
      icon: Key01Icon,
      eyebrow: "You own your keys",
      title: "Lose your password, lose your files.",
      body:
        "That sounds harsh. It's the point. A recovery phrase is your second chance. There is no master key, no admin override, no support ticket that rebuilds your data. Your privacy depends on that.",
    },
  ];

  return (
    <section>
      {/* Section intro */}
      <div style={{ padding: "64px 32px 32px", textAlign: "center" }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: GREEN,
            fontFamily: BRAND_MONO,
          }}
        >
          What we believe
        </span>
        <h2
          style={{
            marginTop: 12,
            fontSize: "2rem",
            lineHeight: 1.1,
            maxWidth: 640,
            marginLeft: "auto",
            marginRight: "auto",
            color: TEXT,
            fontFamily: BRAND_SANS,
            fontWeight: 400,
            letterSpacing: -0.5,
            marginBottom: 0,
          }}
        >
          Three principles we{" "}
          <span style={{ color: GREEN }}>design around</span>.
        </h2>
      </div>

      {/* 3-column grid matching the mockup's features grid */}
      <div
        className="mockup-about-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          borderTop: `1px solid ${BORDER}`,
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        {principles.map((p, i) => (
          <div
            key={p.title}
            style={{
              padding: 28,
              borderRight: i === principles.length - 1 ? "none" : `1px solid ${BORDER}`,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "rgba(239,90,60,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 18,
              }}
            >
              <HugeiconsIcon icon={p.icon} size={20} color={GREEN} strokeWidth={1.5} />
            </div>
            <span
              style={{
                fontSize: 11,
                fontFamily: BRAND_MONO,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: TEXT_MUTED,
                display: "block",
                marginBottom: 10,
              }}
            >
              {p.eyebrow}
            </span>
            <h3
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: TEXT,
                letterSpacing: -0.2,
                margin: "0 0 10px",
                lineHeight: 1.3,
                fontFamily: BRAND_SANS,
              }}
            >
              {p.title}
            </h3>
            <p
              style={{
                fontSize: 14,
                lineHeight: 1.6,
                color: TEXT_MUTED,
                margin: 0,
                fontFamily: BRAND_SANS,
              }}
            >
              {p.body}
            </p>
          </div>
        ))}
      </div>

      <style jsx>{`
        @media (max-width: 900px) {
          .mockup-about-grid {
            grid-template-columns: 1fr !important;
          }
          .mockup-about-grid > div {
            border-right: none !important;
            border-bottom: 1px solid ${BORDER};
          }
          .mockup-about-grid > div:last-child {
            border-bottom: none !important;
          }
        }
      `}</style>
    </section>
  );
}

function WhyBlock() {
  return (
    <section style={{ padding: "64px 32px" }}>
      <div style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 32px" }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: GREEN,
            fontFamily: BRAND_MONO,
          }}
        >
          Why we exist
        </span>
        <h2
          style={{
            marginTop: 12,
            fontSize: "2rem",
            lineHeight: 1.1,
            color: TEXT,
            fontFamily: BRAND_SANS,
            fontWeight: 400,
            letterSpacing: -0.5,
            margin: "12px 0 0",
          }}
        >
          The modern cloud wasn&apos;t built for{" "}
          <span style={{ color: GREEN }}>privacy</span>.
        </h2>
      </div>
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          fontSize: 16,
          lineHeight: 1.75,
          color: TEXT_MUTED,
          fontFamily: BRAND_SANS,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <p style={{ margin: 0 }}>
          Most cloud providers promise privacy. Their business models require
          reading your data. Search, sharing, thumbnails, previews, AI
          summaries: every feature pressures the provider to look inside your
          files.
        </p>
        <p style={{ margin: 0 }}>
          SecureWarp is a different shape. Every convenience (search, preview,
          share links, team workspaces) runs client side, on your device, with
          the server holding only opaque ciphertext. We never had to choose
          between a great UX and actually private storage, because we never
          let the server see your content in the first place.
        </p>
        <p style={{ margin: 0 }}>
          The result is a drive that works like Google Drive and protects your
          files like a password manager. No master key we could hand over. No
          content the server could lose. No surprise in the terms of service.
        </p>
      </div>
    </section>
  );
}

function TeamBlock() {
  const primitives = [
    "XSalsa20-Poly1305",
    "Argon2id",
    "SRP-6a",
    "BIP39",
    "HKDF-SHA256",
    "nacl.box / nacl.secretbox",
  ];
  return (
    <section style={{ padding: "64px 32px" }}>
      <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 32px" }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: GREEN,
            fontFamily: BRAND_MONO,
          }}
        >
          Who&apos;s behind it
        </span>
        <h2
          style={{
            marginTop: 12,
            fontSize: "2rem",
            lineHeight: 1.1,
            color: TEXT,
            fontFamily: BRAND_SANS,
            fontWeight: 400,
            letterSpacing: -0.5,
            margin: "12px 0 0",
          }}
        >
          Small team. <span style={{ color: GREEN }}>Honest work</span>.
        </h2>
      </div>
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: 32,
          border: `1px solid ${BORDER}`,
          borderRadius: 16,
          fontSize: 15,
          lineHeight: 1.7,
          color: TEXT_MUTED,
          fontFamily: BRAND_SANS,
        }}
      >
        <p style={{ margin: "0 0 14px" }}>
          SecureWarp is built by a small independent team. No ads. No selling
          anything about what you store. No investors pushing us to look at
          your data.
        </p>
        <p style={{ margin: 0 }}>
          Zero knowledge isn&apos;t a promise. It&apos;s how the app is put
          together. Every file is encrypted in your browser before upload, and
          our servers only hold ciphertext. We can&apos;t hand over what we
          can&apos;t read.
        </p>
        <div
          style={{
            display: "flex",
            // Single-line strip — `flex-wrap: nowrap` keeps all six
            // primitives in a row. `overflow-x: auto` lets the list
            // scroll on narrow viewports instead of overflowing the
            // card; `white-space: nowrap` on each pill stops the
            // longer labels from breaking mid-name.
            flexWrap: "nowrap",
            gap: 8,
            marginTop: 24,
            paddingTop: 20,
            borderTop: `1px solid ${BORDER}`,
            overflowX: "auto",
          }}
        >
          {primitives.map((p) => (
            <span
              key={p}
              style={{
                fontSize: 10,
                fontFamily: BRAND_MONO,
                letterSpacing: "0.04em",
                color: TEXT,
                background: "rgba(0,0,0,0.03)",
                border: `1px solid ${BORDER}`,
                padding: "4px 9px",
                borderRadius: 6,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {p}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCtaBlock() {
  return (
    <section style={{ padding: "64px 32px", textAlign: "center" }}>
      <h2
        style={{
          fontSize: "2rem",
          lineHeight: 1.1,
          color: TEXT,
          fontFamily: BRAND_SANS,
          fontWeight: 400,
          letterSpacing: -0.5,
          margin: 0,
        }}
      >
        Ready when <span style={{ color: GREEN }}>you are</span>.
      </h2>
      <p
        style={{
          fontSize: 16,
          lineHeight: 1.6,
          color: TEXT_MUTED,
          margin: "16px auto 28px",
          maxWidth: 480,
          fontFamily: BRAND_SANS,
        }}
      >
        Free while in beta. 20 GB included. No credit card. No content we
        could hand over even if someone asked.
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/signup"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontFamily: BRAND_MONO,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            borderRadius: 8,
            padding: "12px 24px",
            fontSize: 12,
            background: GREEN,
            color: "white",
            textDecoration: "none",
          }}
        >
          Get Started
          <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={2} />
        </Link>
        <Link
          href="/"
          style={{
            fontSize: 13,
            color: TEXT_MUTED,
            textDecoration: "none",
            fontFamily: BRAND_SANS,
          }}
        >
          ← Back home
        </Link>
      </div>
    </section>
  );
}
