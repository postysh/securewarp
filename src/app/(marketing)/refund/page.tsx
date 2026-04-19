"use client";

import {
  MarketingShell,
  TEXT,
  TEXT_MUTED,
  BORDER,
  GREEN,
  BRAND_SANS,
  BRAND_SERIF,
  BRAND_MONO,
} from "@/components/marketing-shell";

/**
 * Refund Policy — /refund. Same layout pattern as
 * /privacy and /terms: MarketingShell wrapper + hero +
 * max-w-3xl body column with numbered blocks separated by 1px top
 * rules. Content lifted from src/app/(marketing)/refund/page.tsx.
 */

const EFFECTIVE = "April 17, 2026";

export default function MockupRefund() {
  return (
    <MarketingShell>
      {/* Hero */}
      <section
        style={{
          padding: "96px 32px 32px",
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
          Legal
        </span>
        <h1
          style={{
            marginTop: 12,
            fontSize: "clamp(2.25rem, 4vw, 3rem)",
            lineHeight: 1.1,
            color: TEXT,
            fontFamily: BRAND_SERIF,
            fontWeight: 700,
            letterSpacing: -0.8,
            margin: "12px 0 8px",
          }}
        >
          Refund <span style={{ color: GREEN }}>Policy</span>
        </h1>
        <p
          style={{
            fontSize: 13,
            color: TEXT_MUTED,
            margin: 0,
            fontFamily: BRAND_MONO,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Effective {EFFECTIVE}
        </p>
      </section>

      <style jsx>{`
        .legal-body p {
          margin: 0 0 12px;
          text-wrap: pretty;
        }
        .legal-body p:last-child {
          margin-bottom: 0;
        }
        .legal-body ul {
          margin: 0 0 12px;
          padding-left: 20px;
        }
        .legal-body li {
          margin-bottom: 4px;
        }
        .legal-body strong {
          color: ${TEXT};
          font-weight: 600;
        }
      `}</style>
      <div
        className="legal-body"
        style={{
          maxWidth: 768,
          margin: "0 auto",
          padding: "24px 32px 96px",
          fontFamily: BRAND_SANS,
        }}
      >
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.65,
            color: TEXT_MUTED,
            marginBottom: 48,
            marginTop: 0,
          }}
        >
          If you&apos;re unhappy with SecureWarp within 14 days of your first
          paid charge, we&apos;ll refund it. After 14 days you can still
          cancel at any time to stop future charges, but past periods
          aren&apos;t refundable unless we fail to deliver the service you
          paid for.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          <Block title="1. 14 day money back guarantee">
            <p>
              For the first paid subscription on any account, you may request
              a full refund of your most recent charge within 14 days of that
              charge. Contact us at{" "}
              <A href="mailto:hello@securewarp.com">hello@securewarp.com</A>{" "}
              from the email address on the account and we&apos;ll process
              the refund to the original payment method within 5 business
              days.
            </p>
            <p>
              The 14 day window applies only to your first paid charge on a
              plan. It doesn&apos;t restart when you upgrade, downgrade, or
              re-subscribe after a previous cancellation.
            </p>
          </Block>

          <Block title="2. Cancellations">
            <p>
              You can cancel any paid plan at any time from{" "}
              <strong>Settings → Plan &amp; billing</strong> in the app.
              Canceling stops future charges and keeps your paid features
              active until the end of the billing period you&apos;ve already
              paid for. Once that period ends, your account reverts to the
              Free plan.
            </p>
            <p>
              Cancellation alone doesn&apos;t trigger a refund of the current
              period. If you want a refund for a period that&apos;s already
              started, email us within the 14 day window in section 1.
            </p>
          </Block>

          <Block title="3. Outside the 14 day window">
            <p>
              After 14 days, we don&apos;t issue refunds for past billing
              periods as a matter of course. We still will in these cases:
            </p>
            <ul>
              <Li>
                Service was unavailable for an extended period in a way we
                failed to remedy.
              </Li>
              <Li>You were charged after canceling, due to a bug on our end.</Li>
              <Li>Duplicate or accidental charges caused by our billing system.</Li>
              <Li>
                Fraudulent or unauthorized use of your account that we agree
                is not your fault.
              </Li>
            </ul>
            <p>
              Email{" "}
              <A href="mailto:hello@securewarp.com">hello@securewarp.com</A>{" "}
              with your account email and the relevant transaction date and
              we&apos;ll look into it.
            </p>
          </Block>

          <Block title="4. How refunds are processed">
            <p>
              Payments are processed securely by Stripe. Refunds are issued
              back to the original payment method. Depending on your bank or
              card issuer, it can take 5 to 10 business days for the refund
              to show up on your statement.
            </p>
            <p>
              Refunds of gift or promotional credits aren&apos;t available
              in cash. If you paid partially with a credit, only the cash
              portion is refundable.
            </p>
          </Block>

          <Block title="5. Your data after a refund">
            <p>
              Refunding or canceling a paid plan does <strong>not</strong>{" "}
              delete your data. Your account reverts to the Free plan and
              your encrypted files stay in place, subject to the Free plan
              storage limit. If you&apos;re over the Free plan limit when
              you downgrade, new uploads are paused until you&apos;re back
              under the limit, but existing files remain accessible.
            </p>
            <p>
              If you want us to permanently delete your account and its
              data, do so from Settings → Account → Delete account. That is
              separate from a refund, and it can&apos;t be reversed.
            </p>
          </Block>

          <Block title="6. Contact">
            <p>
              For anything about refunds or billing, write to{" "}
              <A href="mailto:hello@securewarp.com">hello@securewarp.com</A>.
              Include your account email and, if you have it, the Stripe
              receipt ID or charge ID from your email receipt.
            </p>
          </Block>
        </div>
      </div>
    </MarketingShell>
  );
}

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        borderTop: `1px solid ${BORDER}`,
        paddingTop: 32,
      }}
    >
      <h2
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: TEXT,
          margin: "0 0 12px",
          fontFamily: BRAND_SANS,
        }}
      >
        {title}
      </h2>
      <div
        style={{
          fontSize: 14,
          lineHeight: 1.65,
          color: TEXT_MUTED,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return <li style={{ marginBottom: 6, paddingLeft: 4 }}>{children}</li>;
}

function A({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      style={{ color: GREEN, textDecoration: "none", fontWeight: 500 }}
    >
      {children}
    </a>
  );
}
