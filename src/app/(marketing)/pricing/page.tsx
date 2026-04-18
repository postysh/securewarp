"use client";

import Link from "next/link";
import { FloatingParticles } from "@/components/floating-particles";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import { SECTION_MAX, EYEBROW_STYLE, H2_STYLE, GREEN } from "@/lib/marketing-style";
import { HugeiconsIcon } from "@hugeicons/react";
import Tick01Icon from "@hugeicons/core-free-icons/Tick01Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";

type Tier = {
  id: "free" | "plus" | "pro";
  name: string;
  tagline: string;
  priceLabel: string;
  priceSub: string;
  ctaLabel: string;
  ctaHref: string;
  highlight?: boolean;
  features: string[];
};

const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Get started in zero-knowledge land.",
    priceLabel: "$0",
    priceSub: "forever",
    ctaLabel: "Sign up",
    ctaHref: "/signup",
    features: [
      "20 GB encrypted storage",
      "1 user, 1 workspace",
      "Client-side encryption",
      "File sharing with public links",
      "File versioning",
      "Trash with 30-day recovery",
    ],
  },
  {
    id: "plus",
    name: "Plus",
    tagline: "For individuals who need more room.",
    priceLabel: "$4.99",
    priceSub: "per month",
    ctaLabel: "Start Plus",
    ctaHref: "/signup?plan=plus",
    highlight: true,
    features: [
      "500 GB encrypted storage",
      "Up to 3 team seats",
      "Unlimited workspaces",
      "Everything in Free",
      "Priority email support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For small teams handling sensitive work.",
    priceLabel: "$9.99",
    priceSub: "per month",
    ctaLabel: "Start Pro",
    ctaHref: "/signup?plan=pro",
    features: [
      "2 TB encrypted storage",
      "Up to 10 team seats",
      "Unlimited workspaces",
      "Everything in Plus",
      "Workspace admin controls",
    ],
  },
];

const COMPARE_ROWS: { label: string; free: string | boolean; plus: string | boolean; pro: string | boolean }[] = [
  { label: "Storage", free: "20 GB", plus: "500 GB", pro: "2 TB" },
  { label: "Team seats", free: "1", plus: "3", pro: "10" },
  { label: "Workspaces", free: "1", plus: "Unlimited", pro: "Unlimited" },
  { label: "End-to-end encryption", free: true, plus: true, pro: true },
  { label: "Zero-knowledge servers", free: true, plus: true, pro: true },
  { label: "File sharing with links", free: true, plus: true, pro: true },
  { label: "Password-protected links", free: true, plus: true, pro: true },
  { label: "File versioning", free: true, plus: true, pro: true },
  { label: "Two-factor authentication", free: true, plus: true, pro: true },
  { label: "Workspace admin controls", free: false, plus: true, pro: true },
  { label: "Priority support", free: false, plus: true, pro: true },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Can I change plans later?",
    a: "Yes. You can upgrade, downgrade, or cancel any time from Settings → Plan & billing. Upgrades take effect immediately; downgrades kick in at the end of your current billing period.",
  },
  {
    q: "What happens if I cancel?",
    a: "You keep access to the paid plan until the end of your current billing period. After that, your account reverts to the Free plan. Your encrypted data stays put and nothing is deleted.",
  },
  {
    q: "Do you offer refunds?",
    a: "Yes. If you're unhappy within 14 days of your first charge, we'll refund it. See our refund policy for details.",
  },
  {
    q: "Can you read my files?",
    a: "No. Files are encrypted in your browser before upload. Our servers only store ciphertext. Even filenames are encrypted. We literally cannot read your data — and neither can anyone who might compromise our servers.",
  },
  {
    q: "How is billing handled?",
    a: "Payments are processed securely by Stripe. Your card details go straight to Stripe — they never touch SecureWarp's servers. Stripe also handles tax calculation for most jurisdictions automatically.",
  },
  {
    q: "What about larger teams or more storage?",
    a: "Drop us a line at hello@securewarp.com and we'll put together a quote.",
  },
];

export default function Pricing() {
  return (
    <div
      style={{
        fontFamily: "var(--font-chillax), var(--font-geist-sans), system-ui, sans-serif",
        background: "#111",
        minHeight: "100vh",
        position: "relative",
      }}
    >
      <FloatingParticles count={40} />
      <MarketingNav />

      {/* Hero */}
      <section style={{ padding: "140px 32px 48px", maxWidth: SECTION_MAX, margin: "0 auto", textAlign: "center" }}>
        <span style={EYEBROW_STYLE}>Pricing</span>
        <h1 style={{ ...H2_STYLE, fontSize: "clamp(36px, 4.8vw, 56px)", margin: "0 0 16px" }}>
          Simple pricing. No surprises.
        </h1>
        <p style={{ fontSize: 16, color: "rgba(255,255,255,0.55)", maxWidth: 560, margin: "0 auto", lineHeight: 1.6 }}>
          Predictable monthly cost. Hard storage caps so you never get a bigger bill than you expected. Cancel any time.
        </p>
      </section>

      {/* Tier cards */}
      <section style={{ padding: "0 32px 72px", maxWidth: SECTION_MAX, margin: "0 auto" }}>
        <div
          className="tier-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 20,
          }}
        >
          {TIERS.map((t) => (
            <div
              key={t.id}
              style={{
                position: "relative",
                padding: 28,
                borderRadius: 16,
                background: t.highlight ? "rgba(4,164,92,0.06)" : "rgba(255,255,255,0.02)",
                border: t.highlight
                  ? `1px solid ${GREEN}`
                  : "1px solid rgba(255,255,255,0.08)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {t.highlight && (
                <span
                  style={{
                    position: "absolute",
                    top: -10,
                    left: 20,
                    fontSize: 10,
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontWeight: 600,
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    color: "white",
                    background: GREEN,
                    padding: "4px 8px",
                    borderRadius: 4,
                  }}
                >
                  Most popular
                </span>
              )}
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", margin: 0 }}>{t.name}</p>
                <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", margin: "4px 0 0", lineHeight: 1.5 }}>
                  {t.tagline}
                </p>
              </div>
              <div style={{ marginBottom: 20 }}>
                <span style={{ fontSize: 40, fontWeight: 700, color: "white", letterSpacing: -1.5 }}>
                  {t.priceLabel}
                </span>
                <span style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", marginLeft: 6 }}>
                  {t.priceSub}
                </span>
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px", display: "flex", flexDirection: "column", gap: 10 }}>
                {t.features.map((f) => (
                  <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
                    <HugeiconsIcon icon={Tick01Icon} size={14} color={GREEN} style={{ marginTop: 3, flexShrink: 0 }} />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={t.ctaHref}
                style={{
                  marginTop: "auto",
                  display: "block",
                  textAlign: "center",
                  padding: "12px 20px",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: "none",
                  color: t.highlight ? "white" : "rgba(255,255,255,0.85)",
                  background: t.highlight ? GREEN : "rgba(255,255,255,0.06)",
                  border: t.highlight ? "none" : "1px solid rgba(255,255,255,0.12)",
                  transition: "background 160ms ease",
                }}
              >
                {t.ctaLabel}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison table */}
      <section style={{ padding: "48px 32px 96px", maxWidth: SECTION_MAX, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <span style={EYEBROW_STYLE}>Compare</span>
          <h2 style={{ ...H2_STYLE, fontSize: "clamp(24px, 3vw, 32px)", margin: "0 0 8px" }}>
            What&apos;s in each plan
          </h2>
        </div>
        <div style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                <th style={{ textAlign: "left", padding: "14px 20px", color: "rgba(255,255,255,0.45)", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "var(--font-geist-mono), monospace" }}>
                  Feature
                </th>
                {TIERS.map((t) => (
                  <th
                    key={t.id}
                    style={{
                      textAlign: "center",
                      padding: "14px 20px",
                      color: "white",
                      fontWeight: 600,
                      fontSize: 13,
                      borderLeft: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    {t.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={{ padding: "14px 20px", color: "rgba(255,255,255,0.75)" }}>{row.label}</td>
                  {(["free", "plus", "pro"] as const).map((k) => {
                    const v = row[k];
                    return (
                      <td
                        key={k}
                        style={{
                          textAlign: "center",
                          padding: "14px 20px",
                          color: "rgba(255,255,255,0.75)",
                          borderLeft: "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        {typeof v === "boolean" ? (
                          v ? (
                            <HugeiconsIcon icon={Tick01Icon} size={16} color={GREEN} />
                          ) : (
                            <HugeiconsIcon icon={Cancel01Icon} size={14} color="rgba(255,255,255,0.3)" />
                          )
                        ) : (
                          v
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: "0 32px 120px", maxWidth: 760, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <span style={EYEBROW_STYLE}>Questions</span>
          <h2 style={{ ...H2_STYLE, fontSize: "clamp(24px, 3vw, 32px)", margin: "0 0 8px" }}>
            Answers.
          </h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {FAQ.map((item) => (
            <details
              key={item.q}
              style={{
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10,
                padding: "16px 20px",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <summary
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "white",
                  cursor: "pointer",
                  listStyle: "none",
                }}
              >
                {item.q}
              </summary>
              <p
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.6)",
                  lineHeight: 1.65,
                  margin: "10px 0 0",
                }}
              >
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      <MarketingFooter />

      <style>{`
        @media (max-width: 800px) {
          .tier-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
