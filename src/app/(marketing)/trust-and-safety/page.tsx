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

const EFFECTIVE = "April 23, 2026";
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
          SecureWarp encrypts every file in your browser before it reaches our servers. That promise shapes everything on this page. We cannot scan, preview, hash, or review your files, so our trust and safety response is built around metadata we already hold and actions we can take on accounts and share links. What follows is exactly what that toolkit does, and what it does not.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          <Block title="1. What encryption forbids">
            <p>
              Your files and filenames are encrypted on your device and stay encrypted on ours. Because we do not hold the decryption keys, a few things are permanently off the table, no matter who asks:
            </p>
            <ul>
              <Li>We cannot read file contents.</Li>
              <Li>We cannot read filenames or folder names.</Li>
              <Li>We cannot scan for illegal material, match against hash lists, or run any automated content moderation.</Li>
              <Li>We cannot recover a deleted file&apos;s content for anyone, including law enforcement.</Li>
              <Li>We cannot produce plaintext under subpoena, warrant, or National Security Letter.</Li>
            </ul>
            <p>
              This is not a policy we could relax if we wanted to. The keys do not exist on our servers. A court order requiring us to hand over plaintext would ask for something we cannot physically produce.
            </p>
          </Block>

          <Block title="2. Metadata we do hold">
            <p>
              Running a service requires some data. We keep the minimum needed and nothing more:
            </p>
            <ul>
              <Li>Account email and display name.</Li>
              <Li>File sizes, timestamps, and the sharing graph (who granted access to whom).</Li>
              <Li>Share link IDs and their status (active, revoked, expired).</Li>
              <Li>IP addresses briefly, typically one hour, for rate limiting. They are purged automatically after that and are not associated with uploads, downloads, or logins.</Li>
            </ul>
            <p>
              This is the shape of data that content moderation teams at other companies would augment with plaintext scans. We do not have that augmentation and will not build it.
            </p>
          </Block>

          <Block title="3. How to report abuse">
            <p>
              If you received a SecureWarp share link and believe it contains illegal or abusive content, use the <strong>Report this content</strong> link on the share page. No account required.
            </p>
            <p>
              Signed in users can report files shared with them from the drive&apos;s context menu.
            </p>
            <p>
              You can also email{" "}
              <A href={`mailto:${REPORT_EMAIL}`}>{REPORT_EMAIL}</A> with the share URL and a description of what you saw. Include enough detail that we can act on the report without seeing the content ourselves, because we cannot.
            </p>
          </Block>

          <Block title="4. What we do with a report">
            <p>
              Every report enters a human review queue. Since we cannot inspect the file, a reviewer reads your written description alongside the account metadata and decides whether to act. The actions available are narrow and targeted:
            </p>
            <ul>
              <Li>
                <strong>Revoke the share link.</strong> Stops new downloads. The file stays in the uploader&apos;s account.
              </Li>
              <Li>
                <strong>Place an evidence hold on the file.</strong> Freezes it in place so the uploader cannot delete or reshare it while the report is under review. This does not give us access to its contents.
              </Li>
              <Li>
                <strong>Suspend the uploader&apos;s account.</strong> Logs them out and blocks them from signing back in until unsuspended.
              </Li>
              <Li>
                <strong>Ban the uploader&apos;s email and IP.</strong> Reserved for confirmed abuse. Prevents re-registration from the same email or recently used IP.
              </Li>
            </ul>
            <p>
              These are reversible until they are not. A revoked link can be unrevoked; an evidence hold can be lifted. A ban on the email of a confirmed CSAM uploader is permanent.
            </p>
            <p>
              <strong>What we cannot do</strong>: undo downloads. If a recipient opened a link before it was revoked and saved the plaintext to their device, that copy is beyond our reach. This limitation applies to every end-to-end encrypted service.
            </p>
          </Block>

          <Block title="5. CSAM">
            <p>
              Child sexual abuse material is the one category where we automate the first response. The moment a CSAM report is filed:
            </p>
            <ul>
              <Li>The share link is revoked automatically.</Li>
              <Li>The uploader is emailed a neutral notice that their content is under review, with a reference number.</Li>
              <Li>IP preservation turns on for that account going forward, so subsequent logins, uploads, and downloads from the account are logged. Previously purged IPs cannot be recovered.</Li>
            </ul>
            <p>
              A human reviewer then decides whether to place an evidence hold, suspend the account, and file a CyberTipline report with the National Center for Missing &amp; Exploited Children (NCMEC) as required by US law. Our NCMEC report contains the uploader&apos;s email, the timestamps we hold, the IP log where preservation was on, and the reporter&apos;s written description. It does not contain plaintext, because we do not have it.
            </p>
            <p>
              Confirmed CSAM uploaders are terminated and banned from re-registering with the same email. IP bans are added where the preservation log identifies a signup or re-signup IP. NCMEC and law enforcement pursue the case from there.
            </p>
          </Block>

          <Block title="6. IP preservation, in plain language">
            <p>
              A note on IP retention, because this is where reasonable people ask hard questions.
            </p>
            <p>
              For the overwhelming majority of accounts, we do not keep IP addresses. They are held for an hour, used to prevent brute force attempts, and purged. That is the default and it does not change.
            </p>
            <p>
              When a report is filed against a specific uploader, or when an admin opens an investigation on a specific account, IP preservation turns on for that account only. From that point forward, logins, uploads, downloads, and link creations from the account are logged. The IPs are hashed, not stored in the clear. Preservation is per account, not global, and is lifted when the investigation closes unless the account was terminated.
            </p>
            <p>
              We do this so that when law enforcement presents valid process about a flagged account, we can respond with the IP log we lawfully held, rather than nothing. We do not run a continuous surveillance log on the rest of the userbase to make that possible.
            </p>
          </Block>

          <Block title="7. Law enforcement requests">
            <p>
              We respond to lawful process (subpoenas, court orders, search warrants) served on SecureWarp. What we can produce is narrowly bounded:
            </p>
            <ul>
              <Li>Account email, registration timestamp, and display name.</Li>
              <Li>Login history and the IP log for accounts under preservation.</Li>
              <Li>File metadata: size, creation and deletion timestamps, evidence-hold status.</Li>
              <Li>The sharing graph: which accounts were granted or received access, and when.</Li>
              <Li>Share link history and revocation status.</Li>
              <Li>Reports filed by or against the account.</Li>
            </ul>
            <p>
              What we cannot produce: plaintext file contents, filenames, folder structure, or anything that would require a decryption key. No court order can change that, because the keys do not exist on our side.
            </p>
            <p>
              Law enforcement requests should be directed to{" "}
              <A href={`mailto:${REPORT_EMAIL}`}>{REPORT_EMAIL}</A>. We notify affected users of legal process unless the law prohibits it.
            </p>
          </Block>

          <Block title="8. DMCA / copyright">
            <p>
              If you hold copyright on material being shared through SecureWarp without your authorization, send a DMCA notice to{" "}
              <A href={`mailto:${REPORT_EMAIL}`}>{REPORT_EMAIL}</A>. Include:
            </p>
            <ul>
              <Li>Your contact information and electronic or physical signature.</Li>
              <Li>The work or works you claim are infringed.</Li>
              <Li>The SecureWarp share URL of the allegedly infringing material.</Li>
              <Li>A statement of good faith belief that the use is not authorized.</Li>
              <Li>A statement under penalty of perjury that the information is accurate and that you are authorized to act.</Li>
            </ul>
            <p>
              We process compliant notices by revoking the share link and notifying the uploader, who may submit a counter notice. Repeat infringers are terminated.
            </p>
          </Block>

          <Block title="9. False or malicious reports">
            <p>
              Reports are rate-limited and deduplicated. A pattern of false reports targeting a specific user or link can itself result in action against the reporting account or IP. If you submit a report under penalty of perjury (e.g. DMCA), knowingly false statements carry legal liability.
            </p>
            <p>
              Because the initial automated response is deliberately narrow (link revocation and a neutral notice to the uploader), an abusive reporter cannot use this system to delete files, suspend accounts, or impose bans. Those actions require a human reviewer.
            </p>
          </Block>

          <Block title="10. Transparency">
            <p>
              We will publish a periodic transparency report summarizing the volume and categories of reports received, the actions taken, and the number of law enforcement requests received. It will not identify individual users or content.
            </p>
          </Block>

          <Block title="11. Contact">
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
