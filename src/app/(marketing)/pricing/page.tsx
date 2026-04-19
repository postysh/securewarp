"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
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
 * Pricing page — /pricing. Standalone version of the
 * PricingSection that's inlined on the mockup landing. Same
 * Gately-pattern structure: hero + billing-cycle bar + tier cards
 * + full feature comparison table + FAQ + final CTA.
 *
 * Tier and compare-table data kept in sync with
 * src/app/(marketing)/pricing/page.tsx — update both together when
 * plans change.
 */
export default function MockupPricing() {
  return (
    <MarketingShell>
      <HeroBlock />
      <BillCycleBar />
      <TierCards />
      <CompareTable />
      <DottedSpacer />
      <FaqBlock />
      <DottedSpacer />
      <FinalCtaBlock />
    </MarketingShell>
  );
}

// ─── Data ─────────────────────────────────────────────────────

const TIERS: Array<{
  name: string;
  price: string;
  blurb: string;
  features: string[];
  cta: string;
  ctaHref: string;
  featured?: boolean;
}> = [
  {
    name: "Free",
    price: "$0",
    blurb: "Zero knowledge, zero cost.",
    features: [
      "20 GB encrypted storage",
      "1 user, 1 workspace",
      "Client side encryption",
      "File sharing with public links",
      "File versioning",
      "Trash with 30 day recovery",
    ],
    cta: "Sign up",
    ctaHref: "/signup",
  },
  {
    name: "Plus",
    price: "$4.99",
    blurb: "For individuals who need more room.",
    features: [
      "500 GB encrypted storage",
      "Up to 3 team seats",
      "Unlimited workspaces",
      "Everything in Free",
      "Priority email support",
    ],
    cta: "Start Plus",
    ctaHref: "/signup?plan=plus",
    featured: true,
  },
  {
    name: "Pro",
    price: "$9.99",
    blurb: "For small teams handling sensitive work.",
    features: [
      "2 TB encrypted storage",
      "Up to 10 team seats",
      "Unlimited workspaces",
      "Everything in Plus",
      "Priority email support",
    ],
    cta: "Start Pro",
    ctaHref: "/signup?plan=pro",
  },
];

const COMPARE_ROWS: Array<{
  label: string;
  values: Array<string | "check" | "dash">;
}> = [
  { label: "Storage", values: ["20 GB", "500 GB", "2 TB"] },
  { label: "Team seats", values: ["1", "3", "10"] },
  { label: "Workspaces", values: ["1", "Unlimited", "Unlimited"] },
  { label: "End to end encryption", values: ["check", "check", "check"] },
  { label: "Zero knowledge servers", values: ["check", "check", "check"] },
  { label: "File sharing with links", values: ["check", "check", "check"] },
  { label: "Password protected links", values: ["check", "check", "check"] },
  { label: "File versioning", values: ["check", "check", "check"] },
  { label: "Two factor authentication", values: ["check", "check", "check"] },
  { label: "Priority support", values: ["dash", "check", "check"] },
];

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "Can I change plans later?",
    a: "Upgrade, downgrade, or cancel any time from Settings → Plan & billing. Upgrades take effect immediately; downgrades kick in at the end of your current billing period.",
  },
  {
    q: "What happens if I cancel?",
    a: "You keep access to your paid plan until the end of the current billing period. After that, your account reverts to Free. Your encrypted data stays put.",
  },
  {
    q: "Do you offer refunds?",
    a: "Yes. If you're unhappy within 14 days of your first charge, we'll refund it. See our refund policy for details.",
  },
  {
    q: "How is billing handled?",
    a: "Payments go through Stripe. Your card details go straight to Stripe, never to our servers. Stripe handles tax calculation for most jurisdictions automatically.",
  },
  {
    q: "What about larger teams or more storage?",
    a: "Drop us a line at hello@securewarp.com and we'll put together a quote.",
  },
  {
    q: "Can you read my files?",
    a: "No. Files are encrypted in your browser before upload. Our servers only store ciphertext. We literally cannot read your data.",
  },
];

// ─── Components ───────────────────────────────────────────────

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
    <section style={{ padding: "96px 32px 48px", textAlign: "center" }}>
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
        Pricing
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
        Simple, <span style={{ color: GREEN }}>transparent</span> pricing.
      </h1>
      <p
        style={{
          fontSize: 17,
          lineHeight: 1.6,
          maxWidth: 560,
          margin: "0 auto",
          color: TEXT_MUTED,
          fontFamily: BRAND_SANS,
          textWrap: "pretty",
        }}
      >
        Flat monthly tiers for encrypted storage. No data mining, no hidden
        revenue streams, no surprise fees. Every feature on every plan.
      </p>
    </section>
  );
}

function BillCycleBar() {
  return (
    <div
      style={{
        display: "flex",
        borderTop: `1px solid ${BORDER}`,
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      <button
        type="button"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "16px 32px",
          fontSize: 12,
          fontWeight: 500,
          fontFamily: BRAND_MONO,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: TEXT,
          background: "none",
          borderTop: "none",
          borderLeft: "none",
          borderRight: `1px solid ${BORDER}`,
          borderBottom: "none",
          position: "relative",
          cursor: "default",
        }}
      >
        Monthly
        <span
          style={{
            position: "absolute",
            bottom: -1,
            left: 0,
            right: 0,
            height: 2,
            background: GREEN,
          }}
        />
      </button>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: "16px 32px",
        }}
      >
        <p
          style={{
            fontSize: 12,
            lineHeight: 1.625,
            textAlign: "right",
            maxWidth: 384,
            color: TEXT_MUTED,
            margin: 0,
            fontFamily: BRAND_SANS,
          }}
        >
          Cancel anytime. Upgrade or downgrade from Settings whenever the
          fit changes.
        </p>
      </div>
    </div>
  );
}

function TierCards() {
  return (
    <div
      className="mockup-pricing-cards"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      {TIERS.map((t, i) => {
        const isDark = t.featured;
        const subtle = isDark ? "rgba(250,250,249,0.8)" : TEXT_MUTED;
        const textColor = isDark ? "#fff" : TEXT;
        return (
          <div
            key={t.name}
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              padding: 32,
              borderRight:
                i === TIERS.length - 1 ? "none" : `1px solid ${BORDER}`,
              background: isDark ? TEXT : "none",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                fontFamily: BRAND_MONO,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: isDark ? GREEN : TEXT_MUTED,
              }}
            >
              {t.name}
            </span>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "flex-end",
                gap: 4,
              }}
            >
              <span
                style={{
                  fontSize: "3rem",
                  fontWeight: 600,
                  lineHeight: 1,
                  color: textColor,
                  fontFamily: BRAND_SANS,
                }}
              >
                {t.price}
              </span>
              <span
                style={{
                  fontSize: 14,
                  marginBottom: 6,
                  opacity: 0.5,
                  color: textColor,
                  fontFamily: BRAND_SANS,
                }}
              >
                /mo
              </span>
            </div>
            <p
              style={{
                marginTop: 8,
                fontSize: 13,
                color: subtle,
                fontFamily: BRAND_SANS,
              }}
            >
              {t.blurb}
            </p>
            <ul
              style={{
                marginTop: 24,
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                flex: 1,
              }}
            >
              {t.features.map((f) => (
                <li
                  key={f}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <CheckCircle />
                  <span
                    style={{
                      fontSize: 13,
                      color: subtle,
                      fontFamily: BRAND_SANS,
                    }}
                  >
                    {f}
                  </span>
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 32 }}>
              <Link
                href={t.ctaHref}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "12px 20px",
                  border: `1px solid ${isDark ? GREEN : BORDER}`,
                  background: isDark ? GREEN : "none",
                  color: isDark ? "#fff" : TEXT,
                  textDecoration: "none",
                  borderRadius: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    fontFamily: BRAND_MONO,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  {t.cta}
                </span>
                <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={2} />
              </Link>
            </div>
          </div>
        );
      })}
      <style jsx>{`
        @media (max-width: 900px) {
          .mockup-pricing-cards {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

function CompareTable() {
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <CompareHeader label="Features" muted />
        <CompareHeader label="Free" muted align="center" />
        <CompareHeader label="Plus" align="center" />
        <CompareHeader label="Pro" muted align="center" />
      </div>
      {COMPARE_ROWS.map((r, rowIdx) => (
        <div
          key={r.label}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            borderBottom: `1px solid ${BORDER}`,
            background: rowIdx % 2 === 1 ? "rgba(0,0,0,0.015)" : "none",
          }}
        >
          <div
            style={{
              padding: "14px 32px",
              borderRight: `1px solid ${BORDER}`,
            }}
          >
            <span
              style={{
                fontSize: 13,
                color: TEXT_MUTED,
                fontFamily: BRAND_SANS,
              }}
            >
              {r.label}
            </span>
          </div>
          {r.values.map((v, ci) => (
            <div
              key={ci}
              style={{
                padding: "14px 24px",
                borderRight: ci === 2 ? "none" : `1px solid ${BORDER}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {v === "check" ? (
                <CheckCircle />
              ) : v === "dash" ? (
                <span style={{ fontSize: 13, color: BORDER }}>—</span>
              ) : (
                <span
                  style={{
                    fontSize: 13,
                    color: TEXT,
                    fontFamily: BRAND_SANS,
                  }}
                >
                  {v}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function FaqBlock() {
  return (
    <section>
      <div style={{ padding: "48px 32px 24px", textAlign: "center" }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 500,
            fontFamily: BRAND_MONO,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: GREEN,
            margin: 0,
          }}
        >
          Pricing FAQ
        </p>
        <h2
          style={{
            marginTop: 12,
            fontSize: "2rem",
            lineHeight: 1.1,
            maxWidth: 576,
            marginLeft: "auto",
            marginRight: "auto",
            fontFamily: BRAND_SANS,
            fontWeight: 400,
            letterSpacing: -0.5,
            color: TEXT,
            marginBottom: 0,
          }}
        >
          Common questions about{" "}
          <span style={{ color: GREEN }}>billing</span>.
        </h2>
      </div>
      <div
        className="mockup-faq-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          borderTop: `1px solid ${BORDER}`,
        }}
      >
        {FAQS.map((f, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const rows = Math.ceil(FAQS.length / 2);
          return (
            <div
              key={f.q}
              className="mockup-faq-cell"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 32,
                borderRight: col === 0 ? `1px solid ${BORDER}` : "none",
                borderBottom:
                  row === rows - 1 ? "none" : `1px solid ${BORDER}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <span style={{ marginTop: 2 }}>
                  <CheckCircle />
                </span>
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    lineHeight: 1.35,
                    color: TEXT,
                    fontFamily: BRAND_SANS,
                    margin: 0,
                  }}
                >
                  {f.q}
                </p>
              </div>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.625,
                  paddingLeft: 28,
                  color: TEXT_MUTED,
                  fontFamily: BRAND_SANS,
                  margin: 0,
                }}
              >
                {f.a}
              </p>
            </div>
          );
        })}
      </div>
      <style jsx>{`
        @media (max-width: 768px) {
          .mockup-faq-grid {
            grid-template-columns: 1fr !important;
          }
          .mockup-faq-cell {
            border-right: none !important;
          }
        }
      `}</style>
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
        Start free. <span style={{ color: GREEN }}>Upgrade later</span>.
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
        Free while in beta. 20 GB included. No credit card required to get
        started.
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
          Get started free
          <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={2} />
        </Link>
        <Link
          href="/refund"
          style={{
            fontSize: 13,
            color: TEXT_MUTED,
            textDecoration: "none",
            fontFamily: BRAND_SANS,
          }}
        >
          Refund policy →
        </Link>
      </div>
    </section>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function CheckCircle() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ color: GREEN, flexShrink: 0 }}
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12s4.477 10 10 10s10-4.477 10-10Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m8 12.5l2.5 2.5L16 9" />
      </g>
    </svg>
  );
}

function CompareHeader({
  label,
  muted,
  align = "left",
}: {
  label: string;
  muted?: boolean;
  align?: "left" | "center";
}) {
  return (
    <div
      style={{
        padding: align === "center" ? "16px 24px" : "16px 32px",
        borderRight: label === "Pro" ? "none" : `1px solid ${BORDER}`,
        textAlign: align,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          fontFamily: BRAND_MONO,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: muted ? TEXT_MUTED : GREEN,
        }}
      >
        {label}
      </span>
    </div>
  );
}
