"use client";

import { FloatingParticles } from "@/components/floating-particles";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import { SECTION_MAX, EYEBROW_STYLE, H2_STYLE } from "@/lib/marketing-style";

const EFFECTIVE = "April 17, 2026";

export default function Refund() {
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

      <section
        style={{
          padding: "140px 32px 0",
          maxWidth: SECTION_MAX,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <span style={EYEBROW_STYLE}>Legal</span>
        <h1 style={{ ...H2_STYLE, fontSize: "clamp(32px, 4.2vw, 48px)", margin: "0 0 12px" }}>
          Refund Policy
        </h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", margin: "0 0 48px" }}>
          Effective {EFFECTIVE}
        </p>
      </section>

      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{`
        .legal-body p { margin: 0 0 12px; text-wrap: pretty; }
        .legal-body p:last-child { margin-bottom: 0; }
        .legal-body ul { margin: 0 0 12px; padding-left: 20px; }
        .legal-body li { margin-bottom: 4px; }
      `}</style>

      <section
        className="legal-body"
        style={{
          padding: "0 32px 96px",
          maxWidth: 760,
          margin: "0 auto",
          fontSize: 15,
          lineHeight: 1.65,
          color: "rgba(255,255,255,0.65)",
        }}
      >
        <Block title="Summary">
          <p>
            If you&apos;re unhappy with SecureWarp within 14 days of your first
            paid charge, we&apos;ll refund it. After 14 days you can still cancel
            at any time to stop future charges, but past periods aren&apos;t
            refundable unless we fail to deliver the service you paid for.
          </p>
        </Block>

        <Block title="1. 14-day money-back guarantee">
          <p>
            For the first paid subscription on any account, you may request a
            full refund of your most recent charge within 14 days of that
            charge. Contact us at{" "}
            <A href="mailto:hello@securewarp.com">hello@securewarp.com</A>{" "}
            from the email address on the account and we&apos;ll process the
            refund to the original payment method within 5 business days.
          </p>
          <p>
            The 14-day window applies only to your first paid charge on a plan.
            It doesn&apos;t restart when you upgrade, downgrade, or re-subscribe
            after a previous cancellation.
          </p>
        </Block>

        <Block title="2. Cancellations">
          <p>
            You can cancel any paid plan at any time from{" "}
            <strong>Settings → Plan &amp; billing</strong> in the app. Canceling
            stops future charges and keeps your paid features active until the
            end of the billing period you&apos;ve already paid for. Once that
            period ends, your account reverts to the Free plan.
          </p>
          <p>
            Cancellation alone doesn&apos;t trigger a refund of the current
            period. If you want a refund for a period that&apos;s already started,
            email us within the 14-day window in section 1.
          </p>
        </Block>

        <Block title="3. Outside the 14-day window">
          <p>
            After 14 days, we don&apos;t issue refunds for past billing periods
            as a matter of course. We still will in these cases:
          </p>
          <ul>
            <Li>Service was unavailable for an extended period in a way we failed to remedy.</Li>
            <Li>You were charged after canceling, due to a bug on our end.</Li>
            <Li>Duplicate or accidental charges caused by our billing system.</Li>
            <Li>Fraudulent or unauthorized use of your account that we agree is not your fault.</Li>
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
            Payments are processed by Paddle as our merchant of record. Refunds
            are issued back to the original payment method. Depending on your
            bank or card issuer, it can take 5–10 business days for the refund
            to show up on your statement.
          </p>
          <p>
            Refunds of gift or promotional credits aren&apos;t available in cash
            — if you paid partially with a credit, only the cash portion is
            refundable.
          </p>
        </Block>

        <Block title="5. Your data after a refund">
          <p>
            Refunding or canceling a paid plan does <strong>not</strong> delete
            your data. Your account reverts to the Free plan and your encrypted
            files stay in place, subject to the Free-plan storage limit. If
            you&apos;re over the Free-plan limit when you downgrade, new uploads
            are paused until you&apos;re back under the limit, but existing
            files remain accessible.
          </p>
          <p>
            If you want us to permanently delete your account and its data,
            do so from Settings → Account → Delete account. That is separate
            from a refund, and it can&apos;t be reversed.
          </p>
        </Block>

        <Block title="6. Contact">
          <p>
            For anything about refunds or billing, write to{" "}
            <A href="mailto:hello@securewarp.com">hello@securewarp.com</A>.
            Include your account email and, if you have it, the Paddle
            invoice number from your receipt.
          </p>
        </Block>
      </section>

      <MarketingFooter />
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: "white",
          margin: "0 0 16px",
          letterSpacing: -0.3,
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return <li style={{ marginBottom: 6, paddingLeft: 4 }}>{children}</li>;
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} style={{ color: "rgba(110,210,170,0.9)", textDecoration: "none" }}>
      {children}
    </a>
  );
}
