/**
 * Sent to the UPLOADER when their content has been reported. This is
 * a neutral acknowledgement — a report exists and is under review. It
 * contains no reporter details and no decrypted file content (we
 * don't have any). Plaintext fields: user name (safe), report
 * category (safe — it's one of our enum values, not user input).
 */

export interface AbuseReportedData {
  userName: string | null;
  category: string;
  referenceId: string;
}

const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CATEGORY_LABEL: Record<string, string> = {
  csam: "Child sexual abuse material (CSAM)",
  harassment: "Harassment or targeted abuse",
  malware: "Malware, phishing, or scam",
  copyright: "Copyright infringement",
  illegal: "Illegal content",
  other: "Other",
};

export function abuseReportedTemplate(data: AbuseReportedData): {
  subject: string;
  html: string;
  text: string;
} {
  const name = data.userName?.trim() || null;
  const greetingText = name ? `Hi ${name},` : "Hi there,";
  const greetingHtml = name ? `Hi ${escape(name)},` : "Hi there,";
  const categoryLabel = CATEGORY_LABEL[data.category] ?? "Content policy";
  const subject = "Your SecureWarp content is under review";

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
  </head>
  <body style="margin:0;padding:0;background:#faf8f4;color:#0a0a0a;font-family:${SANS};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#faf8f4;">
      <tr>
        <td align="center" style="padding:48px 16px;">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid rgba(0,0,0,0.06);border-radius:10px;">
            <tr>
              <td style="padding:28px 32px 0;">
                <span style="font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#0a0a0a;font-family:${MONO};">
                  Securewarp
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px;">
                <p style="margin:0 0 12px;font-size:11px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:#ef5a3c;font-family:${MONO};">
                  Content under review
                </p>
                <h1 style="margin:0 0 18px;font-size:24px;line-height:1.2;font-weight:400;letter-spacing:-0.5px;color:#0a0a0a;font-family:${SANS};">
                  ${greetingHtml}
                </h1>
                <p style="margin:0 0 12px;font-size:15px;line-height:1.625;color:rgba(0,0,0,0.68);font-family:${SANS};">
                  Someone submitted an abuse report about content in your SecureWarp account. We&apos;ve received it and our trust &amp; safety team is reviewing it.
                </p>
                <p style="margin:0 0 12px;font-size:14px;line-height:1.625;color:rgba(0,0,0,0.68);font-family:${SANS};">
                  Because SecureWarp is end-to-end encrypted, we cannot see the contents of your files — enforcement decisions are based on the reporter&apos;s claim and the metadata we already hold (email, timestamps, sharing relationships).
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 32px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:rgba(0,0,0,0.025);border:1px solid rgba(0,0,0,0.06);border-radius:8px;">
                  <tr>
                    <td style="padding:12px 16px;">
                      <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(0,0,0,0.5);font-family:${MONO};">
                        Report category
                      </p>
                      <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#0a0a0a;font-family:${SANS};">
                        ${escape(categoryLabel)}
                      </p>
                      <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(0,0,0,0.5);font-family:${MONO};">
                        Reference
                      </p>
                      <p style="margin:0;font-size:12px;line-height:1.5;color:rgba(0,0,0,0.68);font-family:${MONO};">
                        ${escape(data.referenceId)}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px;">
                <p style="margin:0 0 12px;font-size:14px;line-height:1.625;color:rgba(0,0,0,0.68);font-family:${SANS};">
                  While we review, the reported content may be temporarily frozen: share links can be revoked and the file may be held from deletion.
                </p>
                <p style="margin:0;font-size:14px;line-height:1.625;color:rgba(0,0,0,0.68);font-family:${SANS};">
                  If you believe this is a mistake, reply to this email with the reference above. If we find the content violates our policies, we&apos;ll take further action and contact you again.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;">
                <div style="height:1px;background:rgba(0,0,0,0.06);"></div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 28px;">
                <p style="margin:0;font-size:11px;line-height:1.6;color:rgba(0,0,0,0.44);font-family:${SANS};">
                  — SecureWarp Trust &amp; Safety
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    "SECUREWARP",
    "CONTENT UNDER REVIEW",
    "",
    greetingText,
    "",
    "Someone submitted an abuse report about content in your SecureWarp account. We've received it and our trust & safety team is reviewing it.",
    "",
    "Because SecureWarp is end-to-end encrypted, we cannot see the contents of your files — enforcement decisions are based on the reporter's claim and the metadata we already hold.",
    "",
    `Report category: ${categoryLabel}`,
    `Reference: ${data.referenceId}`,
    "",
    "While we review, the reported content may be temporarily frozen: share links can be revoked and the file may be held from deletion.",
    "",
    "If you believe this is a mistake, reply to this email with the reference above. If we find the content violates our policies, we'll take further action and contact you again.",
    "",
    "---",
    "— SecureWarp Trust & Safety",
  ].join("\n");

  return { subject, html, text };
}
