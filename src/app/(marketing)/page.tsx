"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import LockIcon from "@hugeicons/core-free-icons/LockIcon";
import Link03Icon from "@hugeicons/core-free-icons/Link03Icon";
import Folder01Icon from "@hugeicons/core-free-icons/Folder01Icon";
import Shield01Icon from "@hugeicons/core-free-icons/Shield01Icon";
import Key01Icon from "@hugeicons/core-free-icons/Key01Icon";
import EyeIcon from "@hugeicons/core-free-icons/EyeIcon";
import HardDriveIcon from "@hugeicons/core-free-icons/HardDriveIcon";
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon";
import CreditCardIcon from "@hugeicons/core-free-icons/CreditCardIcon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";

/**
 * Mockup landing — mirroring Gately's frame.
 *
 * The "two vertical lines running down the page" are the left + right
 * borders of a 1200px centered column. The fixed header shares the
 * same width and border, so the header's side borders visually
 * continue as the body's side borders — one unbroken pair of rules.
 *
 * Logo + menu items match the existing landing's marketing nav:
 * decrypt-reveal "SECUREWARP" text logo with a BETA pill, plus
 * About / Features / Pricing / Support links.
 */

// Light-theme tokens for / only. The rest of the app (auth,
// drive, other marketing pages) stays dark. Cream page background
// matches Gately's warmth; the embedded dashboard mockup stays
// #111-dark and reads as a discrete product shot.
const BG = "#faf8f4";
const TEXT = "#0a0a0a";
const TEXT_MUTED = "rgba(0,0,0,0.55)";
const BORDER = "rgba(0,0,0,0.08)";
// Accent swapped from the original brand green (#04a45c) to the
// warm orange from --text-link (the Sign up link on the auth page).
// GREEN keeps its name for compatibility with existing references;
// it resolves to the same orange that the shell exports.
const BTN_PRIMARY_BG = "rgb(239,90,60)";
const BTN_PRIMARY_FG = "white";
const GREEN = "rgb(239,90,60)";

export default function MockupLanding() {
  return (
    <main
      style={{
        background: BG,
        minHeight: "100vh",
        color: TEXT,
      }}
    >
      {/* Body column — 1200px max, centred, border-x draws the two
          vertical rules running down the page. The header lives
          INSIDE this column and uses `position: sticky` so it shares
          the exact same left/right edges as the body rules. A fixed
          header would be centred on the viewport instead, which
          misaligns by ~half a scrollbar whenever the page scrolls. */}
      <div
        style={{
          width: "100%",
          maxWidth: 1200,
          margin: "0 auto",
          borderLeft: `1px solid ${BORDER}`,
          borderRight: `1px solid ${BORDER}`,
          minHeight: "100vh",
          // White body column over the cream `<main>` — matches the
          // `MarketingShell` wrapper used by the legal pages so gutters
          // stay cream but the centred content reads pure white.
          background: "#ffffff",
        }}
      >
        <HeaderBar />
        <HeroSection />
        <StandardsSection />
        <DotDivider />
        <FeaturesIntroSection />
        <FeaturesGridSection />
        <DotDivider />
        <HighlightsSection />
        <DotDivider />
        <ProductShowcaseSection />
        <DotDivider />
        <HowItWorksSection />
        <DotDivider />
        <PricingSection />
        <DotDivider />
        <FaqSection />
        <DotDivider />
        <MockupFooter />
      </div>
    </main>
  );
}

function HeroSection() {
  return (
    <section
      style={{
        position: "relative",
        // Bottom padding is 0 — the next section (StandardsSection)
        // controls its own top spacing. The old 32px added below the
        // dashboard was stacking with Standards' top padding,
        // producing a top gap 3× larger than the bottom one.
        padding: "112px 32px 0",
      }}
    >
      <div
        className="mockup-hero-grid"
        style={{
          position: "relative",
          zIndex: 10,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)",
          alignItems: "center",
          gap: 48,
        }}
      >
        <div>
        <h1
          style={{
            fontFamily: BRAND_SERIF,
            fontSize: "clamp(2.5rem, 4.5vw, 3.5rem)",
            lineHeight: 1.05,
            color: TEXT,
            maxWidth: 900,
            margin: 0,
            fontWeight: 600,
            letterSpacing: -1.5,
          }}
        >
          The cloud drive that can&apos;t read your files
        </h1>
        <p
          style={{
            marginTop: 20,
            fontSize: 17,
            lineHeight: 1.625,
            maxWidth: 512,
            color: TEXT,
            fontFamily: BRAND_SANS,
            marginBottom: 0,
          }}
        >
          Encrypt every file, folder name, and share link in your browser
          &mdash; your password never reaches our servers.
        </p>
        <div
          style={{
            marginTop: 32,
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
          }}
          className="mockup-hero-ctas"
        >
          <Link
            href="/signup"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              fontFamily: "var(--font-geist-mono), monospace",
              fontWeight: 400,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              borderRadius: 8,
              padding: "12px 24px",
              fontSize: 12,
              background: BTN_PRIMARY_BG,
              color: BTN_PRIMARY_FG,
              textDecoration: "none",
            }}
          >
            Start encrypting everything
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
              style={{ flexShrink: 0 }}
            >
              <path
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M9 6s6 4.419 6 6s-6 6-6 6"
              />
            </svg>
          </Link>
          <a
            href="#how-it-works"
            // `scrollIntoView` is more robust than computing an
            // offset against window.scrollY — works regardless of
            // which element is actually the scroll container. The
            // sticky-header offset is handled by `scroll-margin-top`
            // on the target section itself (see HowItWorksSection).
            onClick={(e) => {
              const target = document.getElementById("how-it-works");
              if (!target) return;
              e.preventDefault();
              target.scrollIntoView({ behavior: "smooth", block: "start" });
              history.replaceState(null, "", "#how-it-works");
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              fontFamily: "var(--font-geist-mono), monospace",
              fontWeight: 400,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              borderRadius: 8,
              padding: "12px 24px",
              fontSize: 12,
              background: "none",
              color: TEXT,
              border: `1px solid ${BORDER}`,
              textDecoration: "none",
            }}
          >
            See how it works
          </a>
        </div>
        <p
          style={{
            marginTop: 16,
            fontSize: 12,
            color: TEXT,
            fontFamily: BRAND_SANS,
            marginBottom: 0,
          }}
        >
          No credit card required · 20 GB free
        </p>
        </div>

        {/* Right column: ciphertext cascade — your file at the top,
            encryption band, server's view of ciphertext below.
            Reinforces the headline ("can't read your files") in a
            single glance. */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
          }}
        >
          <CipherCascade />
        </div>
      </div>

      {/* Dot-grid divider between the hero copy and the product
          screenshot. Negative horizontal margins stretch it from
          vertical rule to vertical rule so it matches the full-bleed
          DotDivider between the hero and the standards strip. */}
      <div style={{ margin: "40px -32px 0" }}>
        <DotDivider />
      </div>

      {/* Product screenshot mockup. Gately mounts /hero_db.png here;
          we don't have a static asset yet so an inline CSS mock of
          the drive UI sits in its place. Swap the inner <div> for
          an <img src="/hero_db.png" /> once the asset exists. */}
      <HeroDashboardFrame />
      <style jsx>{`
        @media (max-width: 900px) {
          .mockup-hero-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}

/**
 * Product showcase — Gately's 3-part section:
 *   1. Two-column header (eyebrow + H2 left, supporting copy right)
 *   2. Horizontal tab bar with 5 product areas, first tab active
 *   3. Tab content panel: sub-heading + simplified app mockup in a
 *      fake browser chrome
 *
 * Tabs are static (no click handlers) — this is a mockup. To make
 * them interactive, lift the selected tab into state and swap the
 * panel body.
 */
function ProductShowcaseSection() {
  const tabs = [
    {
      label: "Files",
      icon: HardDriveIcon,
      url: "securewarp.com/drive",
      h3: "Every file, end to end encrypted",
      body:
        "See what you store and who has access. Upload, share, revoke, or rotate keys. Everything stays encrypted on our side.",
    },
    {
      label: "Sharing",
      icon: Link03Icon,
      url: "securewarp.com/drive",
      h3: "Share without handing over keys",
      body:
        "Time limited links with an optional password. The decryption key lives in the URL fragment — never on our servers.",
    },
    {
      label: "Workspaces",
      icon: UserGroupIcon,
      url: "securewarp.com/workspaces",
      h3: "Separate lives, one password",
      body:
        "Personal, work, client — each workspace has its own keys. Switch with one click without re-entering your password.",
    },
    {
      label: "Billing",
      icon: CreditCardIcon,
      url: "securewarp.com/settings/billing",
      h3: "Flat pricing, powered by Stripe",
      body:
        "No data mining, no hidden fees. Pay for storage, nothing else. Cancel anytime.",
    },
    {
      label: "Security",
      icon: Settings01Icon,
      url: "securewarp.com/settings/security",
      h3: "Two factor auth and recovery, done right",
      body:
        "SRP handshake so your password never reaches us, TOTP on every unlock, and a 24 word phrase you hold in case anything goes wrong.",
    },
  ];
  const [active, setActive] = useState(0);
  const tab = tabs[active];

  return (
    <section>
      {/* Top header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 32,
          padding: "48px 32px",
          borderBottom: `1px solid ${BORDER}`,
        }}
        className="mockup-product-header"
      >
        <div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 400,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              color: GREEN,
              fontFamily: BRAND_MONO,
            }}
          >
            Product
          </span>
          <h2
            style={{
              marginTop: 8,
              fontSize: "2rem",
              lineHeight: 1.1,
              color: TEXT,
              fontFamily: BRAND_SERIF,
              fontWeight: 400,
              letterSpacing: -0.5,
              marginBottom: 0,
            }}
          >
            Built for people who take{" "}
            <span style={{ color: GREEN }}>privacy seriously</span>
          </h2>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.625,
              color: TEXT_MUTED,
              margin: 0,
              fontFamily: BRAND_SANS,
            }}
          >
            Everything you need to store, share, and collaborate without ever
            handing over your keys. One clean drive, zero surveillance.
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        {tabs.map((t, i) => {
          const isActive = i === active;
          return (
            <button
              key={t.label}
              type="button"
              onClick={() => setActive(i)}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                padding: "16px 8px",
                fontSize: 12,
                fontWeight: 400,
                color: isActive ? TEXT : TEXT_MUTED,
                background: "none",
                borderRight:
                  i === tabs.length - 1 ? "none" : `1px solid ${BORDER}`,
                borderTop: "none",
                borderLeft: "none",
                borderBottom: "none",
                position: "relative",
                cursor: "pointer",
                fontFamily: BRAND_SANS,
              }}
            >
              <HugeiconsIcon
                icon={t.icon}
                size={22}
                color={isActive ? GREEN : TEXT_MUTED}
                strokeWidth={1.5}
              />
              {t.label}
              {isActive && (
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
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content panel — copy + browser-framed mockup swap per
          selected tab. */}
      <div
        style={{
          padding: "40px 32px",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div style={{ marginBottom: 32 }}>
          <h3
            style={{
              fontSize: "2rem",
              lineHeight: 1.1,
              maxWidth: 512,
              color: TEXT,
              fontFamily: BRAND_SERIF,
              fontWeight: 400,
              letterSpacing: -0.5,
              margin: 0,
            }}
          >
            {tab.h3}
          </h3>
          <p
            style={{
              marginTop: 12,
              fontSize: 14,
              lineHeight: 1.625,
              maxWidth: 448,
              color: TEXT_MUTED,
              fontFamily: BRAND_SANS,
              marginBottom: 0,
            }}
          >
            {tab.body}
          </p>
        </div>

        {/* Browser-framed app mockup */}
        <div
          style={{
            borderRadius: 16,
            overflow: "hidden",
            border: `1px solid ${BORDER}`,
            background: "#ffffff",
          }}
        >
          <BrowserChrome url={tab.url} />
          <div style={{ padding: 16 }}>
            <div
              style={{
                borderRadius: 12,
                overflow: "hidden",
                border: `1px solid ${BORDER}`,
                background: BG,
                boxShadow: "0 4px 16px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ padding: 20 }}>
                {active === 0 && <FilesPanel />}
                {active === 1 && <SharingPanel />}
                {active === 2 && <WorkspacesPanel />}
                {active === 3 && <BillingPanel />}
                {active === 4 && <SecurityPanel />}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 760px) {
          .mockup-product-header {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}

/**
 * Footer — Gately's pattern (brand col + 3 link cols, bottom ©
 * strip), populated with the content from SecureWarp's existing
 * MarketingFooter so both surfaces stay in lockstep. The crypto
 * primitives strip in the bottom bar is SecureWarp's signature
 * element — kept in place of Gately's X / LinkedIn social links.
 */
function MockupFooter() {
  const cols: Array<{ heading: string; links: Array<{ label: string; href: string; soon?: boolean }> }> = [
    {
      heading: "Product",
      links: [
        { label: "Features", href: "/features" },
        { label: "Pricing", href: "/pricing" },
        { label: "Changelog", href: "#", soon: true },
        { label: "Roadmap", href: "#", soon: true },
      ],
    },
    {
      heading: "Company",
      links: [
        { label: "About", href: "/about" },
        { label: "Support", href: "/support" },
      ],
    },
    {
      heading: "Legal",
      links: [
        { label: "Privacy", href: "/privacy" },
        { label: "Terms", href: "/terms" },
        { label: "Refunds", href: "/refund" },
      ],
    },
  ];

  return (
    <footer style={{ padding: "48px 32px" }}>
      <div
        className="mockup-footer-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 40,
        }}
      >
        {/* Brand col */}
        <div className="mockup-footer-brand">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: TEXT,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontFamily: BRAND_MONO,
              }}
            >
              Securewarp
            </span>
            <span
              style={{
                fontSize: 9,
                fontFamily: BRAND_MONO,
                fontWeight: 600,
                letterSpacing: "0.1em",
                color: GREEN,
                background: "rgba(239,90,60,0.1)",
                border: "1px solid rgba(239,90,60,0.25)",
                padding: "2px 6px",
                borderRadius: 4,
                lineHeight: 1,
              }}
            >
              BETA
            </span>
          </div>
          <p
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: TEXT_MUTED,
              margin: 0,
              maxWidth: 240,
              fontFamily: BRAND_SANS,
            }}
          >
            The cloud drive that can&apos;t read your files. End to end
            encrypted. Zero knowledge by design.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 18 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: GREEN,
                boxShadow: "0 0 8px rgba(239,90,60,0.5)",
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontFamily: BRAND_MONO,
                color: TEXT_MUTED,
                letterSpacing: "0.04em",
              }}
            >
              All systems operational
            </span>
          </div>
        </div>

        {/* Link columns */}
        {cols.map((col) => (
          <div key={col.heading}>
            <p
              style={{
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: TEXT,
                margin: "0 0 16px",
                fontFamily: BRAND_SANS,
              }}
            >
              {col.heading}
            </p>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {col.links.map((l) => (
                <li
                  key={l.label}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <Link
                    href={l.href}
                    style={{
                      fontSize: 13,
                      color: TEXT,
                      opacity: l.soon ? 0.4 : 0.6,
                      textDecoration: "none",
                      fontFamily: BRAND_SANS,
                      cursor: l.soon ? "default" : "pointer",
                    }}
                    onClick={l.soon ? (e) => e.preventDefault() : undefined}
                  >
                    {l.label}
                  </Link>
                  {l.soon && (
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: BRAND_MONO,
                        fontWeight: 600,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: TEXT_MUTED,
                        background: "rgba(0,0,0,0.04)",
                        border: `1px solid ${BORDER}`,
                        padding: "2px 6px",
                        borderRadius: 4,
                        lineHeight: 1,
                      }}
                    >
                      Soon
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Bottom bar */}
      <div
        style={{
          marginTop: 48,
          paddingTop: 24,
          borderTop: `1px solid ${BORDER}`,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <p
          style={{
            fontSize: 12,
            color: TEXT,
            opacity: 0.5,
            margin: 0,
            fontFamily: BRAND_MONO,
          }}
        >
          © {new Date().getFullYear()} SecureWarp. All rights reserved.
        </p>
        {/* Build / status tag. `NEXT_PUBLIC_BUILD_VERSION` is
            injected by next.config.ts at build time, so every
            deploy automatically shows a unique version. */}
        <p
          style={{
            fontSize: 12,
            margin: 0,
            fontFamily: BRAND_MONO,
            letterSpacing: "0.08em",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ color: TEXT, opacity: 0.5 }}>
            {process.env.NEXT_PUBLIC_BUILD_VERSION ?? "dev"}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: GREEN,
              background: "rgba(239,90,60,0.1)",
              border: "1px solid rgba(239,90,60,0.25)",
              padding: "2px 7px",
              borderRadius: 4,
              lineHeight: 1,
            }}
          >
            Beta
          </span>
        </p>
      </div>

      <style jsx>{`
        @media (max-width: 900px) {
          .mockup-footer-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
          .mockup-footer-brand {
            grid-column: span 2;
          }
        }
        @media (max-width: 480px) {
          .mockup-footer-grid {
            grid-template-columns: 1fr !important;
          }
          .mockup-footer-brand {
            grid-column: auto;
          }
        }
      `}</style>
    </footer>
  );
}

/**
 * FAQ section — Gately's pattern: centered intro + 2-column grid of
 * FAQ cells. Each cell has a green check icon beside a bold question
 * and a muted paragraph answer indented to align under the question
 * text. Questions pulled verbatim from the /pricing FAQ so the
 * wording stays in sync.
 */
function FaqSection() {
  const faqs: Array<{ q: string; a: string }> = [
    {
      q: "Can I change plans later?",
      a: "Upgrade, downgrade, or cancel any time from Settings → Plan & billing. Upgrades take effect immediately; downgrades kick in at the end of your current billing period.",
    },
    {
      q: "What happens if I cancel?",
      a: "You keep access to your paid plan until the end of the current billing period. After that, your account reverts to Free. Your encrypted data stays put and nothing is deleted.",
    },
    {
      q: "Do you offer refunds?",
      a: "Yes. If you're unhappy within 14 days of your first charge, we'll refund it. See our refund policy for details.",
    },
    {
      q: "Can you read my files?",
      a: "No. Files are encrypted in your browser before upload. Our servers only store ciphertext. Even filenames are encrypted. We literally cannot read your data — and neither can anyone who compromises our servers.",
    },
    {
      q: "How is billing handled?",
      a: "Payments go through Stripe. Your card details go straight to Stripe, never to our servers. Stripe handles tax calculation for most jurisdictions automatically.",
    },
    {
      q: "What about larger teams or more storage?",
      a: "Drop us a line at hello@securewarp.com and we'll put together a quote.",
    },
  ];

  return (
    <section>
      {/* Intro */}
      <div style={{ padding: "48px 32px 24px", textAlign: "center" }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 400,
            fontFamily: BRAND_MONO,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: GREEN,
            margin: 0,
          }}
        >
          FAQ
        </p>
        <h2
          style={{
            marginTop: 12,
            fontSize: "2rem",
            lineHeight: 1.1,
            maxWidth: 576,
            marginLeft: "auto",
            marginRight: "auto",
            fontFamily: BRAND_SERIF,
            fontWeight: 400,
            letterSpacing: -0.5,
            color: TEXT,
            marginBottom: 0,
          }}
        >
          Common questions
        </h2>
      </div>

      {/* Grid */}
      <div
        className="mockup-faq-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          borderTop: `1px solid ${BORDER}`,
          overflow: "hidden",
        }}
      >
        {faqs.map((f, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const rows = Math.ceil(faqs.length / 2);
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
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
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

/**
 * Pricing section — Gately-pattern 4-part block:
 *   1. Header row (eyebrow + H2)
 *   2. Bill-cycle bar — only "Monthly" since SecureWarp has no
 *      yearly pricing yet; keeping the label slot for visual
 *      symmetry with Gately's reference, plus a right-side blurb.
 *   3. 3-tier card grid (Free / Plus [featured] / Pro). Plus is
 *      rendered with an inverted dark background for contrast.
 *   4. Feature comparison table — 4-column grid, alternating row
 *      background via even-row surface tone.
 *   5. Footer tagline.
 */
function PricingSection() {
  // Source of truth: /pricing page (see src/app/(marketing)/pricing/page.tsx).
  // Keep these in sync when plans or storage tiers change.
  const tiers: Array<{
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
        "Workspace admin controls",
      ],
      cta: "Start Pro",
      ctaHref: "/signup?plan=pro",
    },
  ];

  const compareRows: Array<{
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
    { label: "Workspace admin controls", values: ["dash", "check", "check"] },
    { label: "Priority support", values: ["dash", "check", "check"] },
  ];

  return (
    <section id="pricing">
      {/* Header */}
      <div
        style={{
          padding: "64px 32px",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 400,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: GREEN,
            fontFamily: BRAND_MONO,
          }}
        >
          Pricing
        </span>
        <h2
          style={{
            marginTop: 8,
            fontSize: "2rem",
            lineHeight: 1.1,
            color: TEXT,
            fontFamily: BRAND_SERIF,
            fontWeight: 400,
            letterSpacing: -0.5,
            margin: "8px 0 0",
          }}
        >
          Simple, <span style={{ color: GREEN }}>transparent</span> pricing
        </h2>
      </div>

      {/* Bill cycle + blurb bar */}
      <div
        style={{
          display: "flex",
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
            fontWeight: 400,
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
            Flat pricing for encrypted storage. No data mining, no hidden
            revenue, no surprise fees.
          </p>
        </div>
      </div>

      {/* Tier cards */}
      <div
        className="mockup-pricing-cards"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        {tiers.map((t, i) => {
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
                  i === tiers.length - 1 ? "none" : `1px solid ${BORDER}`,
                background: isDark ? TEXT : "none",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 400,
                  fontFamily: BRAND_MONO,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: isDark ? GREEN : TEXT_MUTED,
                }}
              >
                {t.name}
              </span>
              <div style={{ marginTop: 12, display: "flex", alignItems: "flex-end", gap: 4 }}>
                <span
                  style={{
                    fontSize: "3rem",
                    fontWeight: 600,
                    lineHeight: 1,
                    color: textColor,
                    fontFamily: BRAND_SERIF,
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
                  <li key={f} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <CheckCircle />
                    <span style={{ fontSize: 13, color: subtle, fontFamily: BRAND_SANS }}>
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
                      fontWeight: 400,
                      fontFamily: BRAND_MONO,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    {t.cta}
                  </span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 6s6 4.419 6 6s-6 6-6 6" />
                  </svg>
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {/* Comparison table */}
      <div>
        {/* Table header */}
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
        {compareRows.map((r, rowIdx) => (
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
              <span style={{ fontSize: 13, color: TEXT_MUTED, fontFamily: BRAND_SANS }}>
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
                  <span style={{ fontSize: 13, color: TEXT, fontFamily: BRAND_SANS }}>{v}</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <style jsx>{`
        @media (max-width: 900px) {
          .mockup-pricing-cards {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}

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
          fontWeight: 400,
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

/**
 * 4-step "How it works" section — centered intro + grid of numbered
 * steps with a thin connector line running horizontally through the
 * step-number badges on desktop. Copy adapted from Gately's
 * membership-platform flow to SecureWarp's zero-knowledge signup.
 */
function HowItWorksSection() {
  const steps = [
    {
      title: "Create your account",
      body:
        "Pick a password. Your browser derives the keys with Argon2id. The password never reaches our servers.",
    },
    {
      title: "Save your recovery phrase",
      body:
        "24 BIP39 words only you see. Write them down — it's the only way back in if you forget your password.",
    },
    {
      title: "Upload and encrypt",
      body:
        "Drag any file in. Everything is encrypted in your browser before it leaves your device. We only see ciphertext.",
    },
    {
      title: "Share or collaborate",
      body:
        "Invite by public key or mint a time limited link. Collaborators unwrap the file key client side; we never handle it.",
    },
  ];
  return (
    <section
      id="how-it-works"
      style={{
        padding: "64px 32px",
        // `scroll-margin-top` tells the browser to leave a 56px
        // buffer when this section is scrolled to via an anchor
        // link — keeps the sticky header from cropping the heading.
        scrollMarginTop: 56,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 8,
          marginBottom: 48,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 400,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: GREEN,
            fontFamily: BRAND_MONO,
          }}
        >
          How it works
        </span>
        <h2
          style={{
            fontSize: "2rem",
            lineHeight: 1.1,
            maxWidth: 576,
            color: TEXT,
            fontFamily: BRAND_SERIF,
            fontWeight: 400,
            letterSpacing: -0.5,
            margin: 0,
          }}
        >
          Up and running,{" "}
          <span style={{ color: GREEN }}>in under a minute</span>
        </h2>
        <p
          style={{
            fontSize: 16,
            lineHeight: 1.625,
            maxWidth: 512,
            color: TEXT_MUTED,
            fontFamily: BRAND_SANS,
            margin: 0,
          }}
        >
          No keys to manage, no tech setup. Open your browser, pick a
          password, and your encrypted drive is live.
        </p>
      </div>

      <div
        className="mockup-how-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 24,
        }}
      >
        {steps.map((s, i) => (
          <div key={s.title} style={{ position: "relative" }}>
            {/* Connector line — starts after the 40px badge +
                next-gap, runs rightward. Hidden on the last step
                and on <lg viewports (see style jsx below). */}
            {i < steps.length - 1 && (
              <div
                className="mockup-how-connector"
                aria-hidden
                style={{
                  position: "absolute",
                  top: 20,
                  left: 40,
                  height: 1,
                  width: "calc(100% - 40px)",
                  background: BORDER,
                  zIndex: 0,
                }}
              />
            )}
            <div style={{ position: "relative", zIndex: 1 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: GREEN,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: BRAND_MONO,
                  marginBottom: 16,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              <h3
                style={{
                  fontSize: 11,
                  fontWeight: 400,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: TEXT,
                  fontFamily: BRAND_MONO,
                  margin: "0 0 8px",
                }}
              >
                {s.title}
              </h3>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.625,
                  color: TEXT_MUTED,
                  margin: 0,
                  fontFamily: BRAND_SANS,
                }}
              >
                {s.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      <style jsx>{`
        @media (max-width: 1024px) {
          .mockup-how-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
          .mockup-how-connector {
            display: none !important;
          }
        }
        @media (max-width: 640px) {
          .mockup-how-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}

/**
 * Shared traffic-light window chrome used by every tab mockup.
 * `url` drives the fake address-bar text so each tab reads like a
 * different route in the app.
 */
function BrowserChrome({ url }: { url: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "10px 14px",
        borderBottom: `1px solid ${BORDER}`,
        background: "rgba(0,0,0,0.02)",
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: 5, background: "rgb(252, 165, 165)" }} />
      <span style={{ width: 10, height: 10, borderRadius: 5, background: "rgb(253, 224, 71)" }} />
      <span style={{ width: 10, height: 10, borderRadius: 5, background: "rgb(134, 239, 172)" }} />
      <div
        style={{
          marginLeft: 12,
          height: 20,
          borderRadius: 6,
          background: "rgba(0,0,0,0.04)",
          color: TEXT_MUTED,
          fontSize: 10,
          display: "flex",
          alignItems: "center",
          padding: "0 10px",
          minWidth: 180,
          fontFamily: BRAND_MONO,
        }}
      >
        {url}
      </div>
    </div>
  );
}

function FilesPanel() {
  const rows = [
    { name: "Budget 2026.xlsx", kind: "Personal" },
    { name: "Contract draft.docx", kind: "Shared · 2" },
    { name: "Family photos", kind: "Folder" },
    { name: "API keys.env", kind: "Private" },
  ];
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT, fontFamily: BRAND_SANS }}>My Drive</span>
        <Pill>24 FILES</Pill>
      </div>
      {rows.map((r) => (
        <div
          key={r.name}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 0",
            borderBottom: `1px solid ${BORDER}`,
            fontFamily: BRAND_SANS,
          }}
        >
          <IconSquare icon={LockIcon} />
          <span style={{ fontSize: 12, flex: 1, color: TEXT }}>{r.name}</span>
          <span style={{ fontSize: 11, color: TEXT_MUTED }}>{r.kind}</span>
          <Pill>ENCRYPTED</Pill>
        </div>
      ))}
    </>
  );
}

function SharingPanel() {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT, fontFamily: BRAND_SANS }}>
          Share &ldquo;Contract draft.docx&rdquo;
        </span>
        <Pill>LINK ACTIVE</Pill>
      </div>
      <div
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          border: `1px solid ${BORDER}`,
          background: "#fff",
          fontFamily: BRAND_MONO,
          fontSize: 11,
          color: TEXT_MUTED,
          marginBottom: 14,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        https://securewarp.com/share/f3a9c820
        <span style={{ color: GREEN }}>#key=kN3p9Tx+Rz8qLmVsA6</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontFamily: BRAND_SANS }}>
        {[
          { label: "Expires in", value: "7 days" },
          { label: "Password", value: "Required" },
          { label: "Views", value: "3 / unlimited" },
          { label: "Server sees key", value: "Never" },
        ].map((r) => (
          <div
            key={r.label}
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              border: `1px solid ${BORDER}`,
              background: "#fff",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span style={{ fontSize: 10, color: TEXT_MUTED, fontFamily: BRAND_MONO, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {r.label}
            </span>
            <span style={{ fontSize: 12, color: TEXT }}>{r.value}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function WorkspacesPanel() {
  const ws = [
    { label: "Personal", initial: "P", members: 1, active: true },
    { label: "Acme Corp", initial: "A", members: 8, active: false },
    { label: "Client · Nova", initial: "N", members: 3, active: false },
  ];
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT, fontFamily: BRAND_SANS }}>Workspaces</span>
        <Pill>3 ACTIVE</Pill>
      </div>
      {ws.map((w) => (
        <div
          key={w.label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 0",
            borderBottom: `1px solid ${BORDER}`,
            fontFamily: BRAND_SANS,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "rgba(239,90,60,0.1)",
              color: GREEN,
              fontSize: 12,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              fontFamily: BRAND_MONO,
            }}
          >
            {w.initial}
          </div>
          <span style={{ fontSize: 12, flex: 1, color: TEXT }}>{w.label}</span>
          <span style={{ fontSize: 11, color: TEXT_MUTED }}>
            {w.members} {w.members === 1 ? "member" : "members"}
          </span>
          {w.active ? (
            <Pill>CURRENT</Pill>
          ) : (
            <span style={{ fontSize: 11, color: TEXT_MUTED, fontFamily: BRAND_MONO, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Switch
            </span>
          )}
        </div>
      ))}
    </>
  );
}

function BillingPanel() {
  const tiers = [
    { name: "Free", price: "$0", storage: "20 GB", active: false },
    { name: "Plus", price: "$4.99", storage: "200 GB", active: true },
    { name: "Pro", price: "$9.99", storage: "2 TB", active: false },
  ];
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT, fontFamily: BRAND_SANS }}>Plan and billing</span>
        <Pill>STRIPE</Pill>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {tiers.map((t) => (
          <div
            key={t.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: 8,
              border: t.active ? `1px solid ${GREEN}` : `1px solid ${BORDER}`,
              background: "#fff",
              fontFamily: BRAND_SANS,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, flex: 1, color: TEXT }}>{t.name}</span>
            <span style={{ fontSize: 11, color: TEXT_MUTED, fontFamily: BRAND_MONO, letterSpacing: "0.08em" }}>
              {t.storage}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: t.active ? GREEN : TEXT }}>
              {t.price}
              <span style={{ fontSize: 10, color: TEXT_MUTED, marginLeft: 2 }}>/mo</span>
            </span>
            {t.active && <Pill>CURRENT</Pill>}
          </div>
        ))}
      </div>
    </>
  );
}

function SecurityPanel() {
  const rows = [
    { label: "Two factor auth", meta: "TOTP via authenticator app", status: "enabled" },
    { label: "Recovery phrase", meta: "Last revealed 2 months ago", status: "saved" },
    { label: "Active sessions", meta: "macOS, iOS", status: "2 devices" },
    { label: "Login alerts", meta: "Email on new device", status: "on" },
  ];
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT, fontFamily: BRAND_SANS }}>Security</span>
        <Pill>SRP + TOTP</Pill>
      </div>
      {rows.map((r) => (
        <div
          key={r.label}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 0",
            borderBottom: `1px solid ${BORDER}`,
            fontFamily: BRAND_SANS,
          }}
        >
          <IconSquare icon={Shield01Icon} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 12, color: TEXT }}>{r.label}</span>
            <span style={{ fontSize: 11, color: TEXT_MUTED }}>{r.meta}</span>
          </div>
          <Pill>{r.status.toUpperCase()}</Pill>
        </div>
      ))}
    </>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: 999,
        background: "rgba(239,90,60,0.1)",
        color: GREEN,
        fontFamily: BRAND_MONO,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

function IconSquare({
  icon,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
}) {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(239,90,60,0.1)",
        flexShrink: 0,
      }}
    >
      <HugeiconsIcon icon={icon} size={13} color={GREEN} strokeWidth={2} />
    </div>
  );
}

/**
 * 3-column highlight strip with illustration + copy. Mirrors
 * Gately's "API / Stripe / MCP" triptych but adapted to SecureWarp:
 * client-side key derivation, simple Stripe pricing, and the
 * recovery phrase that only the user holds.
 *
 * Structure per column: 256px tall illustration box with a bottom
 * hairline, then a 24px-padded block with a green mono eyebrow and
 * a muted paragraph. Cells have a right hairline except the last
 * one; the whole strip has a top hairline (via its own
 * `border-t`-equivalent) — already provided by the DotDivider
 * above it in the body column.
 */
function HighlightsSection() {
  return (
    <section
      className="mockup-highlights"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      }}
    >
      <HighlightCell last={false}>
        <HighlightIllustrationKeys />
        <HighlightCopy
          eyebrow="Client side by design"
          body="Your password never reaches our servers. Argon2id derives a master key in your browser; everything else is split from that with HKDF."
        />
      </HighlightCell>
      <HighlightCell last={false}>
        <HighlightIllustrationPricing />
        <HighlightCopy
          eyebrow="Simple pricing, powered by Stripe"
          body="Flat monthly tiers for storage. No data mining, no hidden revenue streams, no surprise fees. Cancel anytime."
        />
      </HighlightCell>
      <HighlightCell last>
        <HighlightIllustrationRecovery />
        <HighlightCopy
          eyebrow="Your recovery phrase, your keys"
          body="24 BIP39 words printed once, held only by you. Forget your password and this gets you back in. Lose it too, and nobody can recover your files — that's the point."
        />
      </HighlightCell>
      <style jsx>{`
        @media (max-width: 900px) {
          .mockup-highlights {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}

function HighlightCell({
  last,
  children,
}: {
  last: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderRight: last ? "none" : `1px solid ${BORDER}`,
      }}
    >
      {children}
    </div>
  );
}

function HighlightCopy({
  eyebrow,
  body,
}: {
  eyebrow: string;
  body: string;
}) {
  return (
    <div
      style={{
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontFamily: BRAND_MONO,
          fontWeight: 400,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: GREEN,
        }}
      >
        {eyebrow}
      </span>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.625,
          color: TEXT_MUTED,
          margin: 0,
          fontFamily: BRAND_SANS,
        }}
      >
        {body}
      </p>
    </div>
  );
}

/**
 * Cell 1: password → Argon2 → master key → three derived keys.
 * Same SVG-diagram-with-connector-pills pattern Gately uses for
 * their API / SDK / Hooks node map.
 */
function HighlightIllustrationKeys() {
  return (
    <div
      style={{
        height: 256,
        borderBottom: `1px solid ${BORDER}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ position: "relative", width: 260, height: 160 }}>
        <svg
          viewBox="0 0 260 160"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        >
          {/* left pill → center pill. `strokeDasharray="12 40"` has
              a 52-length cycle, so the animation's from→to delta
              must equal 52 (or a multiple) for a seamless loop —
              otherwise the dash pattern jumps on restart. Same for
              the "12 50" patterns below (cycle = 62). */}
          <path d="M 60 80 L 110 80" fill="none" stroke={BORDER} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M 60 80 L 110 80" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeDasharray="12 40" opacity="0.85">
            <animate attributeName="stroke-dashoffset" from="52" to="0" dur="1.2s" repeatCount="indefinite" />
          </path>
          {/* center → top-right */}
          <path d="M 170 80 C 188 80, 188 40, 200 40" fill="none" stroke={BORDER} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M 170 80 C 188 80, 188 40, 200 40" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeDasharray="12 50" opacity="0.85">
            <animate attributeName="stroke-dashoffset" from="62" to="0" dur="1.5s" repeatCount="indefinite" />
          </path>
          {/* center → mid-right */}
          <path d="M 170 80 L 200 80" fill="none" stroke={BORDER} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M 170 80 L 200 80" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeDasharray="12 40" opacity="0.85">
            <animate attributeName="stroke-dashoffset" from="52" to="0" dur="1.65s" repeatCount="indefinite" />
          </path>
          {/* center → bottom-right */}
          <path d="M 170 80 C 188 80, 188 120, 200 120" fill="none" stroke={BORDER} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M 170 80 C 188 80, 188 120, 200 120" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeDasharray="12 50" opacity="0.85">
            <animate attributeName="stroke-dashoffset" from="62" to="0" dur="1.8s" repeatCount="indefinite" />
          </path>
        </svg>
        <NodePill left={0} top="50%" label="Password" />
        <NodePill left={110} top="50%" label="Argon2id" />
        <NodePill left={200} top={25} label="SRP" small />
        <NodePill left={200} top="50%" label="Encrypt" small />
        <NodePill left={200} top={114} label="Signing" small />
      </div>
    </div>
  );
}

function NodePill({
  left,
  top,
  label,
  small,
}: {
  left: number;
  top: number | string;
  label: string;
  small?: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        transform: typeof top === "string" ? "translateY(-50%)" : undefined,
        background: BG,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: small ? "6px 10px" : "8px 12px",
        fontSize: small ? 7 : 8,
        fontFamily: BRAND_MONO,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: TEXT_MUTED,
        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
      }}
    >
      {label}
    </div>
  );
}

/**
 * Cell 2: three little pricing cards stacked vertically. Stand-in
 * for Gately's interactive globe — still communicates "pricing".
 */
function HighlightIllustrationPricing() {
  const tiers = [
    { name: "Free", price: "$0", storage: "20 GB" },
    { name: "Plus", price: "$4.99", storage: "200 GB" },
    { name: "Pro", price: "$9.99", storage: "2 TB" },
  ];
  return (
    <div
      style={{
        height: 256,
        borderBottom: `1px solid ${BORDER}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 220 }}>
        {tiers.map((t, i) => (
          <div
            key={t.name}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 14px",
              borderRadius: 10,
              background: BG,
              border: i === 1 ? `1px solid ${GREEN}` : `1px solid ${BORDER}`,
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: TEXT, fontFamily: BRAND_SANS }}>{t.name}</span>
              <span style={{ fontSize: 10, color: TEXT_MUTED, fontFamily: BRAND_MONO, letterSpacing: "0.08em" }}>
                {t.storage}
              </span>
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: i === 1 ? GREEN : TEXT, fontFamily: BRAND_SANS }}>
              {t.price}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Cell 3: mock 12-word BIP39 recovery phrase in a 3-column grid.
 * Shows "you hold the keys" without any interactive complexity.
 */
function HighlightIllustrationRecovery() {
  const words = [
    "cipher",
    "forest",
    "anchor",
    "silent",
    "river",
    "shadow",
    "violet",
    "echo",
    "harbor",
    "candle",
    "marble",
    "quiet",
  ];
  return (
    <div
      style={{
        height: 256,
        borderBottom: `1px solid ${BORDER}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 6,
          maxWidth: 240,
          width: "100%",
        }}
      >
        {words.map((w, i) => (
          <div
            key={w}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 8px",
              borderRadius: 6,
              background: BG,
              border: `1px solid ${BORDER}`,
            }}
          >
            <span
              style={{
                fontSize: 8,
                fontFamily: BRAND_MONO,
                color: TEXT_MUTED,
                letterSpacing: "0.1em",
                minWidth: 14,
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{ fontSize: 11, fontFamily: BRAND_SANS, color: TEXT }}>
              {w}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 3×2 features grid — Gately's pattern. Each cell has an icon pill,
 * a short title, and a one-line paragraph. The outer grid has a top
 * hairline; each cell draws its own right + bottom hairlines,
 * suppressed on the last column / last row so the grid terminates
 * cleanly at the body column's rules. Responsive: 1 col (base) → 2
 * (sm) → 3 (lg).
 */
function FeaturesGridSection() {
  const features: Array<{
    icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
    title: string;
    body: string;
  }> = [
    {
      icon: LockIcon,
      title: "Zero knowledge encryption",
      body:
        "Every file, filename, and folder name is encrypted in your browser. Our servers only ever store ciphertext.",
    },
    {
      icon: Link03Icon,
      title: "Secure link sharing",
      body:
        "Time limited links with an optional password. The decryption key lives in the URL fragment and never touches our servers.",
    },
    {
      icon: Folder01Icon,
      title: "Folder level permissions",
      body:
        "Share whole folders. Everything inside inherits access automatically through hierarchical keys.",
    },
    {
      icon: Shield01Icon,
      title: "Two factor auth + SRP",
      body:
        "Your password never reaches us. TOTP is required on every unlock, not just fresh logins.",
    },
    {
      icon: Key01Icon,
      title: "Recovery phrase",
      body:
        "24-word BIP39 phrase so a forgotten password never locks you out permanently. Only you hold it.",
    },
    {
      icon: EyeIcon,
      title: "Safe file previews",
      body:
        "PDFs, images, docs, and spreadsheets preview in a sandboxed origin so untrusted bytes never run as app code.",
    },
  ];

  const cols = 3;
  const rows = Math.ceil(features.length / cols);

  return (
    <section
      className="mockup-features-grid"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        borderTop: `1px solid ${BORDER}`,
        overflow: "hidden",
      }}
    >
      {features.map((f, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        return (
          <div
            key={f.title}
            style={{
              padding: 24,
              borderRight:
                col === cols - 1 ? "none" : `1px solid ${BORDER}`,
              borderBottom:
                row === rows - 1 ? "none" : `1px solid ${BORDER}`,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "rgba(239,90,60,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <HugeiconsIcon
                icon={f.icon}
                size={16}
                color={GREEN}
                strokeWidth={1.5}
              />
            </div>
            <h3
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: TEXT,
                margin: "0 0 6px",
                fontFamily: BRAND_SANS,
                letterSpacing: -0.1,
              }}
            >
              {f.title}
            </h3>
            <p
              style={{
                fontSize: 13,
                lineHeight: 1.625,
                color: TEXT_MUTED,
                margin: 0,
                fontFamily: BRAND_SANS,
              }}
            >
              {f.body}
            </p>
          </div>
        );
      })}
      <style jsx>{`
        @media (max-width: 1024px) {
          .mockup-features-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
        @media (max-width: 640px) {
          .mockup-features-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}

/**
 * Centered "Features" intro block — accent-coloured eyebrow,
 * display headline with an accent-coloured clause, and a short
 * supporting paragraph. Mirrors Gately's `py-16 px-8` block with the
 * three-tier type hierarchy.
 */
function FeaturesIntroSection() {
  return (
    <section style={{ padding: "64px 32px" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 8,
          marginBottom: 48,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 400,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: GREEN,
            fontFamily: BRAND_MONO,
          }}
        >
          Features
        </span>
        <h2
          style={{
            fontSize: "2rem",
            lineHeight: 1.1,
            // No max-width and whiteSpace: nowrap lock the heading
            // to a single line regardless of the inner column width.
            whiteSpace: "nowrap",
            color: TEXT,
            fontFamily: BRAND_SERIF,
            fontWeight: 400,
            letterSpacing: -0.5,
            margin: 0,
          }}
        >
          Cloud storage,{" "}
          <span style={{ color: GREEN }}>not cloud surveillance</span>
        </h2>
        <p
          style={{
            fontSize: 16,
            lineHeight: 1.625,
            maxWidth: 512,
            color: TEXT_MUTED,
            fontFamily: BRAND_SANS,
            margin: 0,
          }}
        >
          A cloud drive built on one promise &mdash; we never see your files.
          No scanning, no backdoors, no keys on our side.
        </p>
      </div>
    </section>
  );
}

/**
 * Dot-grid strip used as a section divider. Renders the same 24×24
 * dot pattern as before, but confined to a fixed-height band between
 * sections instead of tiling behind the whole page. 72px shows ~3
 * rows of dots.
 */
function DotDivider({ height = 72 }: { height?: number }) {
  return (
    <div
      aria-hidden
      style={{
        height,
        // Subtle hairlines above and below the dot band — same
        // BORDER token as the vertical rules so the whole grid reads
        // as one system.
        borderTop: `1px solid ${BORDER}`,
        borderBottom: `1px solid ${BORDER}`,
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='12' cy='12' r='1' fill='%23000' fill-opacity='0.14'/></svg>\")",
        backgroundSize: "24px 24px",
      }}
    />
  );
}

/**
 * Centered trust strip — Gately's "Integrates with the tools you
 * already use" pattern. SecureWarp doesn't have integrations (it's
 * zero-knowledge storage) so the headline pivots to the underlying
 * cryptographic primitives, which serve the same trust-signal role.
 */
function StandardsSection() {
  const labels = [
    "Argon2id",
    "SRP-6a",
    "xsalsa20",
    "HKDF-SHA256",
    "BIP39",
    "Web Crypto",
    "Noble",
  ];
  return (
    <section
      style={{
        // Symmetric top + bottom padding. Bump both together in
        // equal amounts to keep the heading evenly sandwiched.
        padding: "32px 32px",
      }}
    >
      <p
        style={{
          textAlign: "center",
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: TEXT,
          marginBottom: 32,
          marginTop: 0,
          fontFamily: BRAND_MONO,
          // `line-height: 1` collapses the <p>'s line-box to the
          // text height, so the 16px section padding above is the
          // exact visible gap from the top rule to the characters
          // (no inherited 1.5 line-height adds extra slack).
          lineHeight: 1,
        }}
      >
        Built on open cryptographic standards
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "center",
          gap: 32,
        }}
      >
        {labels.map((label) => (
          <span
            key={label}
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: TEXT,
              opacity: 0.3,
              cursor: "default",
              transition: "opacity 150ms ease",
              fontFamily: BRAND_SANS,
              // Tighten to the text height so the 16px section
              // padding below is the exact visible gap — matches
              // the same treatment on the "Built on…" heading so
              // top and bottom gaps look symmetric.
              lineHeight: 1,
            }}
            className="mockup-standard-label"
          >
            {label}
          </span>
        ))}
      </div>
      <style jsx>{`
        .mockup-standard-label:hover {
          opacity: 0.7 !important;
        }
      `}</style>
    </section>
  );
}

/**
 * Ciphertext cascade — visual for the hero's right column. A single
 * card split into three bands: what you see (a clean file row with
 * a lock icon), the encryption boundary (labelled orange band), and
 * what the server sees (four rows of scrambled base64-looking
 * ciphertext generated deterministically from the filename). The
 * side-by-side with the "can't read your files" headline turns the
 * promise into a visual in one glance.
 */
function CipherCascade() {
  const filename = "Budget 2026.xlsx";
  const meta = "2.4 MB · Private";
  // Deterministic FNV-1a + LCG over the filename so the ciphertext
  // rows look busy-but-stable across renders. Same trick used on
  // the existing landing's `mockCipher()` helper.
  const cipherRows = [
    scramble(filename + ":0", 34),
    scramble(filename + ":1", 34),
    scramble(filename + ":2", 34),
    scramble(filename + ":3", 34),
  ];

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 440,
        background: "#fff",
        border: `1px solid ${BORDER}`,
        borderRadius: 20,
        boxShadow:
          "0 1px 2px rgba(0,0,0,0.04), 0 20px 40px rgba(0,0,0,0.06)",
        overflow: "hidden",
      }}
    >
      {/* ── What you see ───────────────────────────────────── */}
      <div style={{ padding: "20px 22px 16px" }}>
        <CipherPill>You see</CipherPill>
        <div
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            borderRadius: 10,
            border: `1px solid ${BORDER}`,
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "rgba(239,90,60,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <HugeiconsIcon
              icon={LockIcon}
              size={15}
              color={GREEN}
              strokeWidth={2}
            />
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                color: TEXT,
                fontFamily: BRAND_SANS,
                fontWeight: 500,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {filename}
            </div>
            <div
              style={{
                fontSize: 12,
                color: TEXT_MUTED,
                fontFamily: BRAND_SANS,
                marginTop: 2,
              }}
            >
              {meta}
            </div>
          </div>
        </div>
      </div>

      {/* ── Encryption boundary ────────────────────────────── */}
      <div
        style={{
          position: "relative",
          borderTop: `1px dashed ${BORDER}`,
          borderBottom: `1px dashed ${BORDER}`,
          background:
            "repeating-linear-gradient(-45deg, rgba(239,90,60,0.05) 0 6px, transparent 6px 12px)",
          padding: "10px 22px",
          textAlign: "center",
          fontSize: 10,
          fontFamily: BRAND_MONO,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: GREEN,
          fontWeight: 600,
        }}
      >
        Encrypted in your browser
      </div>

      {/* ── What the server sees ───────────────────────────── */}
      <div style={{ padding: "16px 22px 22px" }}>
        <CipherPill muted>Server sees</CipherPill>
        <div
          style={{
            marginTop: 12,
            padding: "14px 16px",
            borderRadius: 10,
            background: "rgba(0,0,0,0.02)",
            border: `1px solid ${BORDER}`,
            fontFamily: BRAND_MONO,
            fontSize: 11,
            lineHeight: 1.7,
            color: TEXT_MUTED,
            letterSpacing: "0.02em",
            overflow: "hidden",
          }}
        >
          {cipherRows.map((row, i) => (
            <div
              key={i}
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "clip",
              }}
            >
              {row}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Renamed from `Pill` to avoid collision with the existing
// dashboard `Pill` helper lower in the file. Used only inside
// `CipherCascade` — signals "You see" / "Server sees" with a
// muted vs green tint.
function CipherPill({
  muted,
  children,
}: {
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10,
        fontFamily: BRAND_MONO,
        textTransform: "uppercase",
        letterSpacing: "0.14em",
        fontWeight: 600,
        color: muted ? TEXT_MUTED : GREEN,
        background: muted ? "rgba(0,0,0,0.04)" : "rgba(239,90,60,0.1)",
        border: `1px solid ${muted ? BORDER : "rgba(239,90,60,0.25)"}`,
        padding: "3px 8px",
        borderRadius: 999,
      }}
    >
      {children}
    </span>
  );
}

/**
 * Deterministic cipher-looking string from a seed. FNV-1a over the
 * seed bytes, then an LCG streaming `length` base64-ish characters.
 * Stable across renders so the ciphertext block doesn't jitter on
 * every React re-paint.
 */
function scramble(seed: string, length: number): string {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/";
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const out: string[] = [];
  for (let i = 0; i < length; i++) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    out.push(alphabet[h % alphabet.length]);
  }
  return out.join("");
}

function HeroDashboardFrame() {
  return (
    <>
      {/* React 19 hoists standalone <link> / <meta> to the document
          head. Preloading the mountain at high priority shrinks the
          window where the #444d52 fallback colour shows on first
          paint before the JPG decodes. */}
      <link
        rel="preload"
        href="/screens/darkmountain.jpg"
        as="image"
        fetchPriority="high"
      />
      <div
        className="mockup-hero-dashframe"
      style={{
        // Wrapper for the forest backdrop + dashboard. Negative
        // horizontal margins undo the parent section's 32px padding
        // so the backdrop reaches the vertical rules on both sides
        // instead of floating in a 32px cream gutter. `position:
        // relative` + `overflow: hidden` anchor the absolute-
        // positioned blurred bg layer below.
        position: "relative",
        overflow: "hidden",
        margin: "0 -32px",
        padding: "64px 32px 0",
      }}
    >
      {/* Blurred mountain backdrop. Kept on its own absolute layer
          so the filter doesn't bleed onto the dashboard sitting on
          top. Scale(1.1) pushes the blurred edges past the wrapper's
          bounds — `filter: blur` softens the image beyond its box,
          and `overflow: hidden` above then clips the soft fringe
          away so nothing feathers onto the cream.
          `backgroundColor: #444d52` is the image's average RGB —
          painted on first paint so the area doesn't flash from
          cream → image while the JPG decodes. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "#444d52",
          backgroundImage: "url('/screens/darkmountain.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(7px)",
          transform: "scale(1.1)",
          pointerEvents: "none",
        }}
      />
      {/* securewarpdash2.png: 1920×1440 with dashboard content at
          1844×977 — ~2% L/R transparent padding, ~16% T/B. Same
          crop trick as before (aspect-ratio matches content,
          transform:scale eats the L/R strip that object-fit cover
          leaves behind). Corner radius is tighter than v1 (~25px
          in source → ~16px at wrapper width), so the wrapper's
          top-corner radius drops back down to match. */}
      <div
        style={{
          // position: relative so the dashboard paints above the
          // absolute blur backdrop in its stacking context.
          position: "relative",
          width: "100%",
          aspectRatio: "1844 / 977",
          overflow: "hidden",
          // Round all four corners — the PNG's dashboard has rounded
          // corners on every side, so leaving the wrapper's bottom
          // two corners sharp exposed cream crescents there.
          borderRadius: 18,
          // Layered shadows: first a crisp 1px dark hairline (the
          // "glassy border") — on a cream bg a white rim blends
          // into the page, a 10% black rim reads as a faint edge
          // around the dark image. Then the soft drop-shadow for
          // elevation. Using box-shadow instead of `border` keeps
          // the rim outside the overflow-hidden clip so it doesn't
          // eat into the image.
          boxShadow:
            "0 0 0 1px rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.12) 0px 20px 40px",
        }}
      >
        <img
          src="/screens/securewarpdash2.png"
          alt="SecureWarp dashboard showing an encrypted file list"
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center",
            transform: "scale(1.045)",
          }}
        />
      </div>
      </div>
    </>
  );
}

/**
 * Decrypt-style reveal of the SECUREWARP wordmark. Lifted from the
 * landing's marketing-nav so the mockup's logo is visually identical.
 * Each slot cycles through random glyphs, then locks in
 * left-to-right. After the reveal finishes, clicking scrolls to top
 * (or navigates home if on a different route).
 */
function LogoReveal({ text }: { text: string }) {
  const [display, setDisplay] = useState<string[]>(() => text.split("").map(() => "*"));
  const [revealed, setRevealed] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const FRAME_MS = 40;
    const REVEAL_DELAY = 110;
    const CYCLES_PER_SLOT = 5;
    const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ*/#@!$%&+<>?";

    let cancelled = false;
    const slots = text.split("");
    const locked = slots.map(() => false);
    const current = slots.map(() => "*");
    let tick = 0;
    const timer = setInterval(() => {
      if (cancelled) return;
      tick++;
      for (let i = 0; i < slots.length; i++) {
        if (locked[i]) continue;
        const startTick = Math.floor((i * REVEAL_DELAY) / FRAME_MS);
        if (tick < startTick) continue;
        const elapsed = tick - startTick;
        if (elapsed >= CYCLES_PER_SLOT) {
          current[i] = slots[i];
          locked[i] = true;
        } else {
          current[i] = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
      }
      setDisplay([...current]);
      if (locked.every(Boolean)) {
        clearInterval(timer);
        setRevealed(true);
      }
    }, FRAME_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [text]);

  const handleClick = () => {
    if (typeof window === "undefined") return;
    if (pathname !== "/") {
      router.push("/");
      return;
    }
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      window.scrollTo(0, 0);
    }
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!revealed}
      aria-label={revealed ? `${text}. Scroll to top` : text}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        margin: 0,
        color: "inherit",
        font: "inherit",
        cursor: revealed ? "pointer" : "default",
        // Nav wordmark on Gately is Geist Mono — matching.
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: 1,
      }}
    >
      {display.join("")}
    </button>
  );
}

// Chillax for everything on the landing (brand sans). Geist Mono
// stays on eyebrows/small UI labels. SERIF aliases SANS so any
// display element that asked for a serif during earlier
// experiments still renders in Chillax.
const CHILLAX_STACK =
  "var(--font-chillax), var(--font-geist-sans), system-ui, sans-serif";
const BRAND_SANS = CHILLAX_STACK;
const BRAND_MONO = "var(--font-geist-mono), ui-monospace, monospace";
const BRAND_SERIF = CHILLAX_STACK;

function HeaderBar() {
  const linkStyle: React.CSSProperties = {
    padding: "8px 16px",
    fontSize: 11,
    color: TEXT,
    textDecoration: "none",
    fontWeight: 400,
    fontFamily: BRAND_MONO,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    borderRadius: 8,
    // Base border + transition inline so the SSR'd HTML already
    // has them — otherwise styled-jsx injects mid-hydration and
    // the transition flashes a border on first paint. Hover /
    // active CSS below uses `!important` to beat inline specificity.
    border: "1px solid transparent",
    transition: "border-color 160ms ease, background-color 160ms ease",
  };

  return (
    <header
      style={{
        // Sticky inside the body column so the header's left/right
        // edges are the body column's left/right edges — one shared
        // width, guaranteed alignment with the vertical rules.
        position: "sticky",
        top: 0,
        zIndex: 50,
        // No side borders — the parent column already draws those
        // and the sticky header sits flush inside them. Only a
        // bottom rule to separate it from the hero.
        borderBottom: `1px solid ${BORDER}`,
        // Frosted-glass on the cream bg: low-opacity white lets the
        // cream show through, blur + saturate keeps scrolled content
        // legible under it.
        background: "rgba(255,255,255,0.55)",
        backdropFilter: "blur(28px) saturate(180%)",
        WebkitBackdropFilter: "blur(28px) saturate(180%)",
      }}
    >
      <div
        style={{
          padding: "0 24px",
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Logo — flex:1 matches the CTA cluster on the right so the
            nav stays optically centred */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            color: TEXT,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontFamily: BRAND_MONO,
          }}
        >
          <LogoReveal text="SECUREWARP" />
          <span
            style={{
              fontSize: 9,
              fontFamily: BRAND_MONO,
              fontWeight: 600,
              letterSpacing: "0.1em",
              // On light bg the pastel green tint vanishes — use the
              // solid brand green for text and a 10%-alpha green
              // background so the pill still reads.
              color: GREEN,
              background: "rgba(239,90,60,0.1)",
              border: "1px solid rgba(239,90,60,0.25)",
              padding: "2px 6px",
              borderRadius: 4,
              lineHeight: 1,
            }}
            aria-label="Beta product"
          >
            BETA
          </span>
        </div>

        {/* Center nav — same labels + styling as the marketing shell's
            nav. Hover/active styling lives in the styled-jsx block
            below (see `.nav-bar .nav-link`). */}
        <nav
          className="nav-bar"
          style={{ display: "flex", alignItems: "center", gap: 0 }}
        >
          <Link href="/about" className="nav-link" style={linkStyle}>
            About
          </Link>
          <Link href="/features" className="nav-link" style={linkStyle}>
            Features
          </Link>
          <Link href="/pricing" className="nav-link" style={linkStyle}>
            Pricing
          </Link>
          <Link href="/support" className="nav-link" style={linkStyle}>
            Support
          </Link>
        </nav>
        <style jsx global>{`
          .nav-bar .nav-link:hover {
            border-color: ${BORDER} !important;
          }
          .nav-bar .nav-link:active {
            border-color: rgba(0, 0, 0, 0.14) !important;
            background-color: rgba(0, 0, 0, 0.02);
          }
        `}</style>

        {/* Right CTAs */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flex: 1,
            justifyContent: "flex-end",
          }}
        >
          <Link
            href="/login"
            style={{
              fontSize: 11,
              fontWeight: 400,
              padding: "6px 14px",
              color: TEXT,
              textDecoration: "none",
              fontFamily: BRAND_MONO,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
            }}
          >
            Log in
          </Link>
          <Link
            href="/signup"
            style={{
              fontSize: 11,
              fontWeight: 400,
              padding: "6px 14px",
              borderRadius: 8,
              background: BTN_PRIMARY_BG,
              color: BTN_PRIMARY_FG,
              textDecoration: "none",
              fontFamily: BRAND_MONO,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}
