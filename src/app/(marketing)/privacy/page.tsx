"use client";

import { FloatingParticles } from "@/components/floating-particles";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import {
  SECTION_MAX,
  EYEBROW_STYLE,
  H2_STYLE,
} from "@/lib/marketing-style";

const EFFECTIVE = "April 16, 2026";

export default function Privacy() {
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
          Privacy Policy
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
        <Block title="1. Who we are">
          <p>
            SecureWarp is a zero knowledge encrypted cloud storage service
            based in Minnesota, United States. You can reach us
            at <A href="mailto:hello@securewarp.com">hello@securewarp.com</A>.
          </p>
        </Block>

        <Block title="2. Zero knowledge encryption">
          <p>
            Every file, folder name, and share is encrypted in your browser
            before it reaches our servers. We store only ciphertext and do not
            hold the keys to decrypt it. Your password never leaves your device.
          </p>
          <p>
            If you lose both your password and your 24 word recovery phrase,
            your data is permanently inaccessible. We cannot reset your
            password or recover your files. This is by design.
          </p>
        </Block>

        <Block title="3. What we collect">
          <p>We collect the minimum data required to run the service:</p>
          <ul>
            <Li><strong>Account info:</strong> email address, optional display name</Li>
            <Li><strong>Encrypted files:</strong> stored as ciphertext we cannot read</Li>
            <Li><strong>Metadata:</strong> file sizes, timestamps, sharing relationships</Li>
            <Li><strong>Technical data:</strong> IP address (temporarily, for rate limiting), session cookies (for authentication)</Li>
          </ul>
          <p>
            We use cookieless, aggregated analytics that do not build per user
            profiles. We use error monitoring with all personal data stripped
            before transmission.
          </p>
          <p>
            <strong>We do not collect</strong> plaintext file contents, filenames,
            passwords, or recovery phrases.
          </p>
        </Block>

        <Block title="4. How we use your data">
          <ul>
            <Li>Provide and maintain the service</Li>
            <Li>Authenticate your identity and manage sessions</Li>
            <Li>Send transactional email (no marketing without your consent)</Li>
            <Li>Prevent abuse and enforce rate limits</Li>
          </ul>
        </Block>

        <Block title="5. Third parties">
          <p>
            We do not sell your personal data. We do not share it with
            advertisers or data brokers.
          </p>
          <p>
            We use a small number of service providers to operate the
            platform (hosting, database, email delivery, error monitoring).
            Each processes data only as necessary to deliver their service to
            us and is not authorized to use it for their own purposes. Your
            file contents remain encrypted and unreadable to all parties,
            including us and our providers.
          </p>
        </Block>

        <Block title="6. Data retention and deletion">
          <p>
            Account data is retained until you delete your account. Encrypted
            files are deleted when you delete them, empty trash, or delete
            your account. IP addresses for rate limiting are retained briefly
            (typically one hour) then purged automatically.
          </p>
          <p>
            You can delete your account and all associated data at any time
            from Settings. Deletion is permanent and irreversible.
          </p>
        </Block>

        <Block title="7. Your rights">
          <p>
            Depending on where you live, you may have the right to access,
            correct, delete, or export your personal data. You may also have
            the right to opt out of the sale of personal data or targeted
            advertising. We do not sell personal data or engage in targeted
            advertising.
          </p>
          <p>
            Because your files are end to end encrypted, we cannot access or
            produce the plaintext content of your files in response to any
            request. We can provide the account metadata we hold (email,
            timestamps, sharing relationships).
          </p>
          <p>
            To exercise your rights, contact us
            at <A href="mailto:hello@securewarp.com">hello@securewarp.com</A>.
          </p>
        </Block>

        <Block title="8. International transfers">
          <p>
            Our servers are located in the United States. If you access the
            service from outside the US, your data will be transferred to and
            processed in the US. Because file contents are encrypted before
            they leave your device, the plaintext never crosses any border.
          </p>
        </Block>

        <Block title="9. Security">
          <p>
            We use strong encryption and modern authentication protocols to
            protect your data. No system is perfectly secure. We are committed
            to notifying affected users within 48 hours of discovering a data
            breach, consistent with Minnesota law.
          </p>
        </Block>

        <Block title="10. Children">
          <p>
            SecureWarp is not directed at children under 13. We do not
            knowingly collect data from children under 13. If we become aware
            of such data, we will delete the account promptly.
          </p>
        </Block>

        <Block title="11. Changes">
          <p>
            If we make material changes to this policy, we will notify you at
            least 15 days in advance via email or an in app notice. Continued
            use after the effective date constitutes acceptance.
          </p>
        </Block>

        <Block title="12. Contact">
          <p>
            Questions or data rights
            requests: <A href="mailto:hello@securewarp.com">hello@securewarp.com</A>.
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
  return (
    <li style={{ marginBottom: 6, paddingLeft: 4 }}>{children}</li>
  );
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} style={{ color: "rgba(110,210,170,0.9)", textDecoration: "none" }}>
      {children}
    </a>
  );
}
