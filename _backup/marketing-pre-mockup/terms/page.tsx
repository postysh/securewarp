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

export default function Terms() {
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
          Terms of Service
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
        <Block title="1. Acceptance and eligibility">
          <p>
            By creating an account or using SecureWarp, you agree to these Terms
            of Service and our <A href="/privacy">Privacy Policy</A>. If you do
            not agree, do not use the service.
          </p>
          <p>
            You must be at least 13 years old to use SecureWarp. If you are
            located in the European Union, you must be at least 16 years old or
            have parental consent. By creating an account, you represent that you
            meet these age requirements.
          </p>
        </Block>

        <Block title="2. Service description">
          <p>
            SecureWarp is a zero knowledge encrypted cloud storage service. Files,
            folder names, and shares are encrypted in your browser before upload.
            Our servers store only ciphertext. We cannot read, search, or inspect
            your file contents.
          </p>
          <p>
            The service is currently in beta. During beta, each account receives
            20 GB of free storage. We may introduce paid plans in the future with
            reasonable advance notice. Paid plans will not reduce your existing
            free storage allocation without your consent.
          </p>
        </Block>

        <Block title="3. Your account">
          <p>
            You are responsible for maintaining the confidentiality of your
            password and recovery phrase. SecureWarp cannot reset your password
            or recover your data if you lose both. This is a fundamental
            property of zero knowledge encryption, not a limitation we can remove.
          </p>
          <p>
            You must provide accurate information when creating your account.
            You may not create accounts for the purpose of abusing the service,
            circumventing rate limits, or impersonating others.
          </p>
          <p>
            You are responsible for all activity that occurs under your account.
            If you believe your account has been compromised, contact us
            immediately at <A href="mailto:hello@securewarp.com">hello@securewarp.com</A>.
          </p>
        </Block>

        <Block title="4. Your content">
          <p>
            You retain all rights to the content you upload to SecureWarp. We do
            not claim any ownership, license, or access rights over your encrypted
            data. Because your content is end to end encrypted, we cannot and do
            not access, review, or analyze it.
          </p>
          <p>
            You are solely responsible for the content you upload, share, and
            distribute through the service. You represent that you have the legal
            right to store and share any content you upload.
          </p>
        </Block>

        <Block title="5. Acceptable use">
          <p>You agree not to use SecureWarp to:</p>
          <ul>
            <Li>Upload, store, or distribute content that violates applicable law</Li>
            <Li>Distribute malware, viruses, or other harmful software</Li>
            <Li>Store or distribute child sexual abuse material (CSAM)</Li>
            <Li>Harass, threaten, or intimidate others via shared files or links</Li>
            <Li>Circumvent rate limits, storage quotas, or other service restrictions</Li>
            <Li>Attempt to access other users&apos; accounts, files, or encryption keys</Li>
            <Li>Use the service to conduct phishing, fraud, or social engineering attacks</Li>
            <Li>Reverse engineer, decompile, or disassemble any part of the service</Li>
          </ul>
          <p>
            While we cannot inspect encrypted content, we reserve the right to
            suspend or terminate accounts based on metadata patterns, user reports,
            or valid legal process. We may comply with lawful requests from
            authorities to the extent required by applicable law.
          </p>
        </Block>

        <Block title="6. Digital Millennium Copyright Act (DMCA)">
          <p>
            SecureWarp respects the intellectual property rights of others. Because
            content is end to end encrypted, we cannot verify whether specific files
            infringe copyright. However, we will respond to valid DMCA takedown
            notices by disabling access to identified files or accounts.
          </p>
          <p>
            To submit a DMCA takedown notice, send the following to our designated
            agent at <A href="mailto:hello@securewarp.com">hello@securewarp.com</A>:
          </p>
          <ul>
            <Li>Identification of the copyrighted work claimed to be infringed</Li>
            <Li>Identification of the material to be removed (file ID, share link URL, or account)</Li>
            <Li>Your contact information</Li>
            <Li>A statement that you have a good faith belief that use of the material is not authorized</Li>
            <Li>A statement that the information is accurate and, under penalty of perjury, you are authorized to act on behalf of the copyright owner</Li>
            <Li>Your physical or electronic signature</Li>
          </ul>
          <p>
            We will notify the affected user and provide an opportunity to submit
            a counter notification in accordance with 17 U.S.C. §512.
          </p>
        </Block>

        <Block title="7. Sharing and collaboration">
          <p>
            SecureWarp allows you to share files and folders with other registered
            users and via public links. When you share content, you grant the
            recipient the ability to decrypt and view that content using the
            cryptographic keys you provide.
          </p>
          <p>
            You are responsible for whom you share with. Once a recipient has
            decrypted your content, we cannot prevent them from retaining a copy.
            Revoking access prevents future decryption but cannot undo what
            someone already downloaded.
          </p>
          <p>
            Anyone with a share link can access the shared content. Treat
            share links with the same care as a password.
          </p>
        </Block>

        <Block title="8. Service availability and beta">
          <p>
            SecureWarp is provided on an &quot;as is&quot; and &quot;as available&quot;
            basis during the beta period. We do not guarantee uninterrupted or
            error free operation. We may modify, suspend, or discontinue features
            with reasonable notice.
          </p>
          <p>
            We make no warranty, express or implied, including but not limited to
            warranties of merchantability, fitness for a particular purpose, or
            non infringement.
          </p>
        </Block>

        <Block title="9. Limitation of liability">
          <p>
            To the maximum extent permitted by applicable law, SecureWarp and its
            operators shall not be liable for any indirect, incidental, special,
            consequential, or punitive damages, including but not limited to loss
            of data, loss of profits, or loss of business, arising from your use
            of or inability to use the service.
          </p>
          <p>
            Our total aggregate liability for any claim arising from or related
            to the service shall not exceed the amount you paid us in the twelve
            months preceding the claim, or fifty US dollars ($50), whichever is
            greater.
          </p>
          <p>
            Nothing in these terms excludes or limits liability that cannot be
            lawfully excluded, including liability for fraud or gross negligence.
          </p>
        </Block>

        <Block title="10. Account termination and data deletion">
          <p>
            You may delete your account at any time from Settings. Account
            deletion permanently removes your account data, all encrypted files,
            and all sharing relationships. This action is irreversible.
          </p>
          <p>
            We may suspend or terminate your account if you violate these Terms,
            if required by law, or if your account is identified as part of a
            pattern of abuse. We will provide notice where practicable, except
            where doing so would compromise an ongoing investigation or risk
            harm to others.
          </p>
          <p>
            Upon termination, your right to use the service ends immediately.
            We may delete your data after a reasonable retention period unless
            legally required to preserve it.
          </p>
        </Block>

        <Block title="11. Indemnification">
          <p>
            You agree to indemnify and hold harmless SecureWarp and its operators
            from and against any claims, damages, losses, or expenses (including
            reasonable legal fees) arising from your use of the service, your
            violation of these Terms, or your violation of any rights of a third
            party.
          </p>
        </Block>

        <Block title="12. Governing law and jurisdiction">
          <p>
            These Terms are governed by and construed in accordance with the laws
            of the State of Minnesota, United States, without regard to conflict
            of law principles.
          </p>
          <p>
            Any dispute arising from or related to these Terms or the service
            shall be resolved exclusively in the state or federal courts located
            in Hennepin County, Minnesota. You consent to the personal jurisdiction
            of those courts.
          </p>
          <p>
            Before filing any legal claim, you agree to attempt to resolve the
            dispute informally by contacting us
            at <A href="mailto:hello@securewarp.com">hello@securewarp.com</A>.
            We will attempt to resolve the dispute within 30 days.
          </p>
        </Block>

        <Block title="13. Changes to these terms">
          <p>
            We may update these Terms from time to time. If we make material
            changes, we will notify you at least 30 days in advance via email or
            an in app notice. The effective date at the top of this page reflects
            the most recent update.
          </p>
          <p>
            Continued use of the service after the effective date of revised
            terms constitutes acceptance. If you do not agree to the updated
            terms, you may delete your account before they take effect.
          </p>
        </Block>

        <Block title="14. Severability">
          <p>
            If any provision of these Terms is held to be invalid or
            unenforceable, that provision will be modified to the minimum extent
            necessary to make it enforceable, and the remaining provisions will
            continue in full force and effect.
          </p>
        </Block>

        <Block title="15. Entire agreement">
          <p>
            These Terms, together with the <A href="/privacy">Privacy Policy</A>,
            constitute the entire agreement between you and SecureWarp with respect
            to the service and supersede all prior agreements, representations, and
            understandings.
          </p>
        </Block>

        <Block title="16. Contact">
          <p>
            If you have questions about these Terms, contact us
            at <A href="mailto:hello@securewarp.com">hello@securewarp.com</A>.
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
