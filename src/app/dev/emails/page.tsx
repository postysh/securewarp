import Link from "next/link";

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
 * Dev-only index for inspecting the transactional email templates.
 * Each tile links to a preview page that renders the template inside
 * an isolated iframe using fixture data, alongside its subject line
 * and plain-text body so you can proofread both formats.
 *
 * Delete this directory before shipping if you don't want it exposed
 * in production. Same caveat as /dev/errors.
 */

const TEMPLATES: Array<{
  name: string;
  heading: string;
  desc: string;
  trigger: string;
}> = [
  {
    name: "welcome",
    heading: "Welcome",
    desc: "One-time onboarding email. Sent on successful signup.",
    trigger: "POST /api/auth/register",
  },
  {
    name: "support-received",
    heading: "Support received (admin)",
    desc: "Forwarded to the support inbox when a user submits the contact form.",
    trigger: "POST /api/support/message",
  },
  {
    name: "support-ack",
    heading: "Support ack (user)",
    desc: "Auto-reply to the user after their support message lands.",
    trigger: "POST /api/support/message",
  },
  {
    name: "billing-receipt",
    heading: "Billing receipt",
    desc: "Sent on every successful Stripe renewal. User-configurable.",
    trigger: "webhook: invoice.paid",
  },
  {
    name: "billing-payment-failed",
    heading: "Payment failed",
    desc: "Urgent alert when a charge bounces. Always-on (bypasses prefs).",
    trigger: "webhook: invoice.payment_failed",
  },
  {
    name: "billing-renewal-reminder",
    heading: "Renewal reminder",
    desc: "Heads-up ~3 days before the next invoice finalizes. User-configurable.",
    trigger: "webhook: invoice.upcoming",
  },
];

export default function EmailPreviewIndex() {
  return (
    <MarketingShell>
      <section style={{ padding: "96px 32px 48px", textAlign: "center" }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: GREEN,
            fontFamily: BRAND_MONO,
            margin: "0 0 12px",
          }}
        >
          Dev · Email preview
        </p>
        <h1
          style={{
            fontSize: "clamp(2rem, 4vw, 3rem)",
            lineHeight: 1.05,
            color: TEXT,
            fontFamily: BRAND_SANS,
            fontWeight: 400,
            letterSpacing: -1,
            margin: "0 auto 12px",
            maxWidth: 620,
          }}
        >
          Proof every transactional email before it ships
        </h1>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.6,
            color: TEXT_MUTED,
            margin: "0 auto",
            maxWidth: 560,
            fontFamily: BRAND_SANS,
          }}
        >
          Each tile renders the real template with fixture data inside an
          isolated iframe. Subject line and plain-text body are shown alongside.
        </p>
      </section>

      <div
        className="dev-email-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          borderTop: `1px solid ${BORDER}`,
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        {TEMPLATES.map((t, i) => {
          const col = i % 3;
          const row = Math.floor(i / 3);
          const lastRow = row === Math.floor((TEMPLATES.length - 1) / 3);
          return (
            <div
              key={t.name}
              style={{
                padding: 28,
                borderRight: col === 2 ? "none" : `1px solid ${BORDER}`,
                borderBottom: lastRow ? "none" : `1px solid ${BORDER}`,
                display: "flex",
                flexDirection: "column",
                gap: 14,
                minHeight: 200,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontFamily: BRAND_MONO,
                  color: TEXT_MUTED,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                {t.trigger}
              </span>
              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: TEXT,
                  margin: 0,
                  fontFamily: BRAND_SANS,
                  letterSpacing: -0.2,
                }}
              >
                {t.heading}
              </h3>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: TEXT_MUTED,
                  margin: 0,
                  fontFamily: BRAND_SANS,
                  flex: 1,
                }}
              >
                {t.desc}
              </p>
              <div>
                <Link
                  href={`/dev/emails/${t.name}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontFamily: BRAND_MONO,
                    fontWeight: 500,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    borderRadius: 8,
                    padding: "10px 18px",
                    fontSize: 11,
                    background: "none",
                    color: TEXT,
                    border: `1px solid ${BORDER}`,
                    textDecoration: "none",
                  }}
                >
                  Preview →
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @media (max-width: 900px) {
          .dev-email-grid {
            grid-template-columns: 1fr !important;
          }
          .dev-email-grid > div {
            border-right: none !important;
            border-bottom: 1px solid ${BORDER} !important;
          }
          .dev-email-grid > div:last-child {
            border-bottom: none !important;
          }
        }
      `}</style>
    </MarketingShell>
  );
}
