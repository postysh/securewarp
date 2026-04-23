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
 * Trust & Safety — /trust-and-safety. Explains how abuse reporting
 * works on a zero-knowledge platform: what we can and cannot see,
 * how to report, what we can do in response. Required reading for
 * any recipient who receives a share link and wants to flag abuse.
 */

const EFFECTIVE = "April 22, 2026";
const REPORT_EMAIL = "trust@securewarp.com";

export default function TrustAndSafetyPage() {
  return (
    <MarketingShell>
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
          Policy
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
          Trust <span style={{ color: GREEN }}>& Safety</span>
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
          SecureWarp encrypts every file in your browser before it reaches our servers. We cannot read file contents or filenames. That promise has real consequences for abuse enforcement, and this page explains how we handle reports of illegal or harmful content on the platform.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          <Block title="1. What we can and cannot see">
            <p>
              Files uploaded to SecureWarp are encrypted on your device using
              XChaCha20-Poly1305. Filenames and folder names are encrypted
              too. The only things our servers observe are:
            </p>
            <ul>
              <Li>The uploader&apos;s email address</Li>
              <Li>File sizes, timestamps, and sharing relationships</Li>
              <Li>Share link IDs and whether they are revoked or expired</Li>
              <Li>IP addresses (kept briefly for rate limiting, then purged)</Li>
            </ul>
            <p>
              We cannot inspect file contents to proactively detect illegal
              material. We also cannot scan file names, hashes of decrypted
              bytes, or any signal that would require a decryption key. This
              is a deliberate design choice and a non-negotiable part of the
              product.
            </p>
          </Block>

          <Block title="2. How to report abuse">
            <p>
              If you received a SecureWarp share link and believe it contains
              illegal or abusive content, use the <strong>Report this content</strong> link on the share page. No account required. Reports go directly to our trust and safety queue.
            </p>
            <p>
              You can also email{" "}
              <A href={`mailto:${REPORT_EMAIL}`}>{REPORT_EMAIL}</A> with the
              share URL and a description of the issue. Include enough detail
              for us to act on the report without seeing the content.
            </p>
            <p>
              Signed-in users can report files shared with them from the
              file browser&apos;s context menu. The same queue handles both
              anonymous and authenticated reports.
            </p>
          </Block>

          <Block title="3. Categories we act on">
            <ul>
              <Li>
                <strong>Child sexual abuse material (CSAM).</strong> Always
                escalated to the National Center for Missing & Exploited
                Children (NCMEC) where required by US law.
              </Li>
              <Li>
                <strong>Malware, phishing, or scams.</strong> Links are
                revoked and the uploader is contacted.
              </Li>
              <Li>
                <strong>Harassment or targeted abuse.</strong> Links are
                revoked; repeat offenders are suspended.
              </Li>
              <Li>
                <strong>Copyright infringement.</strong> Handled per DMCA;
                see the separate counter-notice process below.
              </Li>
              <Li>
                <strong>Other illegal content.</strong> Handled case by case,
                in cooperation with law enforcement where appropriate.
              </Li>
            </ul>
          </Block>

          <Block title="4. What we can do in response">
            <p>
              Because we cannot read the content, our enforcement actions
              target the uploader and the share link, not the file bytes:
            </p>
            <ul>
              <Li>Revoke the share link so new recipients cannot access it</Li>
              <Li>Suspend or terminate the uploader&apos;s account</Li>
              <Li>Preserve metadata (IP logs, timestamps, sharing graph) for law enforcement requests</Li>
              <Li>Cooperate with lawful process from relevant authorities</Li>
            </ul>
            <p>
              We cannot un-decrypt a file that a recipient has already
              downloaded. A revoked link stops new access, but cached
              plaintext on a visitor&apos;s device is out of our reach. This is
              the same limitation that applies to every end-to-end encrypted
              service.
            </p>
          </Block>

          <Block title="5. CSAM">
            <p>
              CSAM is the most serious category and the least ambiguous.
              Reports in this category are prioritized, the link is revoked
              immediately, and a CyberTipline report is filed with NCMEC
              containing the uploader&apos;s metadata. The uploader&apos;s
              account is terminated and banned from re-registration on the
              same email.
            </p>
            <p>
              We do not hold or review CSAM content. Our report to NCMEC
              contains the uploader email, timestamps, IP logs, and the
              reporter&apos;s description of what they saw. NCMEC and law
              enforcement pursue the case from there.
            </p>
          </Block>

          <Block title="6. DMCA / copyright">
            <p>
              If you hold copyright on material being shared through
              SecureWarp without your authorization, send a DMCA notice to{" "}
              <A href={`mailto:${REPORT_EMAIL}`}>{REPORT_EMAIL}</A>. Include:
            </p>
            <ul>
              <Li>Your contact information and electronic or physical signature</Li>
              <Li>The work or works you claim are infringed</Li>
              <Li>The SecureWarp share URL of the allegedly infringing material</Li>
              <Li>A statement of good faith belief that the use is not authorized</Li>
              <Li>A statement under penalty of perjury that the information is accurate and that you are authorized to act</Li>
            </ul>
            <p>
              We process compliant notices by revoking the share link and
              notifying the uploader, who may submit a counter-notice.
              Repeat infringers are terminated.
            </p>
          </Block>

          <Block title="7. Law enforcement requests">
            <p>
              We respond to lawful process (subpoenas, court orders, search
              warrants) served on SecureWarp. Because we do not hold
              decryption keys, we cannot produce plaintext file contents
              under any order. We can and do produce the account metadata we
              hold: email, login timestamps, IP addresses within the
              retention window, and the sharing graph.
            </p>
            <p>
              Law enforcement requests should be directed to{" "}
              <A href={`mailto:${REPORT_EMAIL}`}>{REPORT_EMAIL}</A>. We
              notify affected users of legal process unless the law prohibits
              it.
            </p>
          </Block>

          <Block title="8. False or malicious reports">
            <p>
              Reports are rate-limited and deduplicated to prevent spam. A
              pattern of false reports targeting a specific user or link may
              itself result in action against the reporting account or IP.
              If you submit a report under penalty of perjury (e.g. DMCA),
              knowingly false statements carry legal liability.
            </p>
          </Block>

          <Block title="9. Transparency">
            <p>
              We will publish a periodic transparency report summarizing the
              volume and categories of reports received and actions taken. It
              will not identify individual users or content.
            </p>
          </Block>

          <Block title="10. Contact">
            <p>
              Trust and safety:{" "}
              <A href={`mailto:${REPORT_EMAIL}`}>{REPORT_EMAIL}</A>
              <br />
              General:{" "}
              <A href="mailto:hello@securewarp.com">hello@securewarp.com</A>
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
