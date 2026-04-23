"use client";

import { useEffect, useState } from "react";
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
 * Transparency report — /transparency. The page reads live from
 * GET /api/transparency, which aggregates file_reports + admin_audit
 * + law_enforcement_requests into the numbers below. No hand-edited
 * counts.
 *
 * Until we add frozen annual snapshots, the page always shows the
 * current calendar year to date and is clearly labeled as a report
 * in progress.
 */

const REPORT_EMAIL = "trust@securewarp.com";

// Canary text — dated. If this page is ever updated WITHOUT the
// canary appearing, that signals something we cannot disclose has
// happened. That's the canary's whole purpose. Don't remove it
// silently; if the statement can no longer be truthfully made,
// publish the page with the canary section omitted and let the
// omission speak.
const CANARY_DATE = "April 23, 2026";

type Category = "csam" | "harassment" | "malware" | "copyright" | "illegal" | "other";

interface TransparencyData {
  periodStart: string;
  periodEnd: string;
  inProgress: boolean;
  generatedAt: string;
  reports: {
    byCategory: Record<Category, number>;
    total: number;
  };
  actions: {
    linksRevoked: number;
    evidenceHoldsPlaced: number;
    accountsSuspended: number;
    reportsDismissed: number;
    accountsBanned: number;
    ncmecReportsFiled: number;
  };
  lawEnforcement: {
    byType: {
      subpoenaUs: number;
      warrantUs: number;
      preservationUs: number;
      mlat: number;
      nsl: number;
      other: number;
    };
    byOutcome: {
      produced: number;
      challenged: number;
      rejected: number;
      pending: number;
    };
    total: number;
  };
}

/**
 * Small number banding: zero is shown exactly, counts 1 through 4
 * collapse to "< 5", and 5 or more are shown exactly. Matches the
 * banding rule enforced server side so the server and client agree
 * on what readers see.
 */
function band(count: number): string {
  if (count === 0) return "0";
  if (count < 5) return "< 5";
  return String(count);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function TransparencyPage() {
  const [data, setData] = useState<TransparencyData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/transparency");
        if (!res.ok) throw new Error("Failed to load report");
        setData(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load report");
      }
    })();
  }, []);

  const periodLabel = data
    ? data.inProgress
      ? `${formatDate(data.periodStart)} · through today (report in progress)`
      : `${formatDate(data.periodStart)} – ${formatDate(data.periodEnd)}`
    : "Loading…";

  return (
    <MarketingShell>
      <section style={{ padding: "96px 32px 32px", textAlign: "center" }}>
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
          Accountability
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
          Transparency <span style={{ color: GREEN }}>Report</span>
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
          {periodLabel}
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
        .tr-table {
          width: 100%;
          border-collapse: collapse;
          margin: 0 0 8px;
          font-size: 14px;
          font-family: ${BRAND_SANS};
        }
        .tr-table th {
          text-align: left;
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: ${TEXT_MUTED};
          font-family: ${BRAND_MONO};
          padding: 0 0 10px;
          border-bottom: 1px solid ${BORDER};
        }
        .tr-table th:last-child {
          text-align: right;
        }
        .tr-table td {
          padding: 10px 0;
          border-bottom: 1px solid ${BORDER};
          color: ${TEXT};
        }
        .tr-table td:last-child {
          text-align: right;
          font-family: ${BRAND_MONO};
          font-variant-numeric: tabular-nums;
          color: ${TEXT};
        }
        .tr-table tr:last-child td {
          border-bottom: none;
        }
        .tr-section-total td {
          border-top: 1px solid ${BORDER};
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
            marginBottom: 32,
            marginTop: 0,
          }}
        >
          This report documents the abuse reports we received, the actions we
          took, and the law enforcement requests served on SecureWarp during
          the period above. Numbers are read live from our reports database
          and our legal process intake log. Counts below five are published
          in bands to prevent small number deanonymization.
        </p>

        {data?.inProgress && (
          <div
            style={{
              marginBottom: 32,
              padding: "12px 16px",
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
              background: "rgba(0,0,0,0.015)",
              fontSize: 13,
              lineHeight: 1.5,
              color: TEXT_MUTED,
            }}
          >
            <strong style={{ color: TEXT }}>Report in progress.</strong>{" "}
            The period above closes at the end of the calendar year. Numbers
            update automatically as events occur and as admins log incoming
            legal requests. A frozen snapshot is archived at period close.
          </div>
        )}

        {/* Warrant canary — distinctive callout */}
        <div
          style={{
            marginBottom: 48,
            padding: "20px 24px",
            border: `1px solid ${BORDER}`,
            borderLeft: `3px solid ${GREEN}`,
            borderRadius: 6,
            background: "rgba(0,0,0,0.015)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              color: GREEN,
              fontFamily: BRAND_MONO,
              marginBottom: 10,
            }}
          >
            Warrant Canary · {CANARY_DATE}
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.6,
              color: TEXT,
            }}
          >
            As of {CANARY_DATE}, SecureWarp has never received a National
            Security Letter, FISA court order, gag order, or any other
            classified legal demand that we are unable to publicly
            acknowledge. The absence of this statement from a future
            transparency report should be interpreted accordingly.
          </p>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 32,
              padding: "12px 16px",
              border: "1px solid rgba(239,90,60,0.25)",
              borderRadius: 6,
              background: "rgba(239,90,60,0.05)",
              fontSize: 13,
              color: "rgb(239,90,60)",
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          <Block title="1. Abuse reports received">
            <p>
              Reports submitted by users from the public share page and the
              drive&apos;s context menu. Because files are end-to-end
              encrypted, every report includes a written description — a
              reviewer reads that description, not the file, and decides
              whether to act.
            </p>
            <table className="tr-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Reports</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Child sexual abuse material (CSAM)</td>
                  <td>{data ? band(data.reports.byCategory.csam) : "—"}</td>
                </tr>
                <tr>
                  <td>Malware, phishing, or scam</td>
                  <td>{data ? band(data.reports.byCategory.malware) : "—"}</td>
                </tr>
                <tr>
                  <td>Harassment or targeted abuse</td>
                  <td>{data ? band(data.reports.byCategory.harassment) : "—"}</td>
                </tr>
                <tr>
                  <td>Copyright infringement</td>
                  <td>{data ? band(data.reports.byCategory.copyright) : "—"}</td>
                </tr>
                <tr>
                  <td>Other illegal content</td>
                  <td>{data ? band(data.reports.byCategory.illegal) : "—"}</td>
                </tr>
                <tr>
                  <td>Other / unclassified</td>
                  <td>{data ? band(data.reports.byCategory.other) : "—"}</td>
                </tr>
                <tr className="tr-section-total">
                  <td>Total</td>
                  <td>{data ? band(data.reports.total) : "—"}</td>
                </tr>
              </tbody>
            </table>
          </Block>

          <Block title="2. Actions taken">
            <p>
              Narrow by design. Every action below targets the account or the
              share link, never the encrypted file contents. Reversible
              actions are listed first; permanent actions at the bottom.
            </p>
            <table className="tr-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Share links revoked</td>
                  <td>{data ? band(data.actions.linksRevoked) : "—"}</td>
                </tr>
                <tr>
                  <td>Files placed under evidence hold</td>
                  <td>{data ? band(data.actions.evidenceHoldsPlaced) : "—"}</td>
                </tr>
                <tr>
                  <td>Accounts suspended pending review</td>
                  <td>{data ? band(data.actions.accountsSuspended) : "—"}</td>
                </tr>
                <tr>
                  <td>Reports dismissed (no violation found)</td>
                  <td>{data ? band(data.actions.reportsDismissed) : "—"}</td>
                </tr>
                <tr>
                  <td>Accounts terminated + banned (confirmed abuse)</td>
                  <td>{data ? band(data.actions.accountsBanned) : "—"}</td>
                </tr>
                <tr>
                  <td>CyberTipline reports filed with NCMEC</td>
                  <td>{data ? band(data.actions.ncmecReportsFiled) : "—"}</td>
                </tr>
              </tbody>
            </table>
          </Block>

          <Block title="3. Law enforcement requests">
            <p>
              Requests for account metadata served on SecureWarp through
              lawful process. We do not hold plaintext content, so no
              response we produce includes file contents, filenames, or
              folder structure. What we can produce is enumerated in our{" "}
              <A href="/trust-and-safety">trust &amp; safety policy</A>.
            </p>
            <table className="tr-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Subpoenas (US)</td>
                  <td>{data ? band(data.lawEnforcement.byType.subpoenaUs) : "—"}</td>
                </tr>
                <tr>
                  <td>Search warrants (US)</td>
                  <td>{data ? band(data.lawEnforcement.byType.warrantUs) : "—"}</td>
                </tr>
                <tr>
                  <td>Preservation orders (US)</td>
                  <td>{data ? band(data.lawEnforcement.byType.preservationUs) : "—"}</td>
                </tr>
                <tr>
                  <td>International (MLAT)</td>
                  <td>{data ? band(data.lawEnforcement.byType.mlat) : "—"}</td>
                </tr>
                <tr>
                  <td>National Security Letters</td>
                  <td>{data ? band(data.lawEnforcement.byType.nsl) : "—"}</td>
                </tr>
                <tr>
                  <td>Other</td>
                  <td>{data ? band(data.lawEnforcement.byType.other) : "—"}</td>
                </tr>
                <tr className="tr-section-total">
                  <td>Total</td>
                  <td>{data ? band(data.lawEnforcement.total) : "—"}</td>
                </tr>
              </tbody>
            </table>

            <p style={{ marginTop: 20 }}>
              Of the requests received, metadata was produced for those that
              met our validity requirements. Requests that were overbroad,
              facially invalid, or sought information we do not hold were
              challenged or declined.
            </p>
            <table className="tr-table">
              <thead>
                <tr>
                  <th>Outcome</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Metadata produced</td>
                  <td>{data ? band(data.lawEnforcement.byOutcome.produced) : "—"}</td>
                </tr>
                <tr>
                  <td>Challenged or narrowed</td>
                  <td>{data ? band(data.lawEnforcement.byOutcome.challenged) : "—"}</td>
                </tr>
                <tr>
                  <td>Rejected as invalid</td>
                  <td>{data ? band(data.lawEnforcement.byOutcome.rejected) : "—"}</td>
                </tr>
                <tr>
                  <td>Still pending at read time</td>
                  <td>{data ? band(data.lawEnforcement.byOutcome.pending) : "—"}</td>
                </tr>
              </tbody>
            </table>
          </Block>

          <Block title="4. Legal posture">
            <p>
              SecureWarp is a US company headquartered in Minnesota. We
              respond to valid US legal process served on SecureWarp. We do
              not voluntarily disclose user data; every request is
              evaluated against the statute cited, and requests we consider
              overbroad, facially invalid, or outside the scope of what we
              hold are challenged or declined.
            </p>
            <p>
              Requests from non-US authorities are evaluated under the
              applicable mutual legal assistance treaty (MLAT) framework.
              We do not directly comply with foreign legal process without
              an MLAT path.
            </p>
            <p>
              Where the law permits, we notify the affected user of legal
              process against their account so they can seek counsel.
              When a gag order forbids notification, we comply with the
              gag but update the warrant canary accordingly.
            </p>
          </Block>

          <Block title="5. Methodology">
            <p>
              Abuse report counts are drawn directly from our reports
              database. Action counts are drawn from the admin audit log.
              Law enforcement request counts are drawn from the internal
              intake log that trust &amp; safety staff update as each
              request arrives.
            </p>
            <p>
              <strong>Banding</strong>: counts below 5 are published as
              &ldquo;&lt; 5&rdquo; to prevent combining this report with
              externally visible signals (revocation dates, account
              creation timestamps) to identify a specific case.
            </p>
            <p>
              <strong>Scope</strong>: this report covers the entire
              SecureWarp service. Workspaces do not receive separate
              reports.
            </p>
            <p>
              <strong>Refresh</strong>: the public page caches results for
              five minutes at the edge, so a number you see may trail the
              underlying database by a few minutes.
            </p>
          </Block>

          <Block title="6. Prior reports">
            <p style={{ color: TEXT_MUTED }}>
              This is SecureWarp&apos;s first reporting period. Future
              periods will be archived below this section, most recent
              first, preserving the record in its original form.
            </p>
          </Block>

          <Block title="7. Contact">
            <p>
              For questions about this report or to serve legal process:{" "}
              <A href={`mailto:${REPORT_EMAIL}`}>{REPORT_EMAIL}</A>
              <br />
              General questions:{" "}
              <A href="mailto:hello@securewarp.com">hello@securewarp.com</A>
            </p>
            {data && (
              <p style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 16 }}>
                Last refreshed {formatDate(data.generatedAt)}.
              </p>
            )}
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
      <div style={{ fontSize: 14, lineHeight: 1.65, color: TEXT_MUTED }}>
        {children}
      </div>
    </div>
  );
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
