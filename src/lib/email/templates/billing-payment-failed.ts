/**
 * Payment failed — sent on invoice.payment_failed webhook.
 *
 * Bypasses notification prefs. A silent failed charge means the plan
 * downgrades to Free on the next retry cycle, with no chance for the
 * user to fix it. Treated as actionable/security-adjacent for that
 * reason — same bucket as password reset / new device alerts.
 *
 * Visual language matches the marketing site, but swaps the brand
 * orange accent for a deeper alert-red (#c63a2c) on the status pill,
 * eyebrow, callout, and primary CTA. The red is hue-adjacent to the
 * brand orange so it still reads as "our palette," just with more
 * urgency. The SECUREWARP wordmark + BETA pill stay orange so the
 * brand block is consistent with every other template.
 *
 * Zero-knowledge: plaintext fields only. See AGENTS.md → "Email".
 */

export interface BillingPaymentFailedData {
  displayName?: string | null;
  planLabel: string;
  amountFormatted: string;
  portalUrl: string;
  retryDate?: string | null;
}

const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const ALERT = "#c63a2c";
const ALERT_BG = "rgba(198,58,44,0.08)";
const ALERT_BORDER = "rgba(198,58,44,0.22)";

export function billingPaymentFailedTemplate(data: BillingPaymentFailedData): {
  subject: string;
  html: string;
  text: string;
} {
  const name = data.displayName?.trim() || null;
  const greetingText = name ? `Hi ${name},` : "Hi there,";
  const greetingHtml = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
  const subject = `Action needed: payment failed for your SecureWarp ${data.planLabel} plan`;
  const retryText = data.retryDate
    ? `We'll try again on ${data.retryDate}.`
    : "We'll retry automatically in the next few days.";

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
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#0a0a0a;font-family:${MONO};padding-right:10px;">
                      Securewarp
                    </td>
                    <td style="font-size:9px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#ef5a3c;background:rgba(239,90,60,0.1);border:1px solid rgba(239,90,60,0.25);padding:3px 7px;border-radius:4px;font-family:${MONO};line-height:1;">
                      Beta
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 0;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:14px;">
                  <tr>
                    <td style="font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${ALERT};background:${ALERT_BG};border:1px solid ${ALERT_BORDER};padding:4px 8px;border-radius:4px;font-family:${MONO};line-height:1;">
                      ● Payment failed
                    </td>
                  </tr>
                </table>
                <h1 style="margin:0 0 16px;font-size:28px;line-height:1.15;font-weight:400;letter-spacing:-0.6px;color:#0a0a0a;font-family:${SANS};">
                  ${greetingHtml}
                </h1>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.625;color:rgba(0,0,0,0.7);font-family:${SANS};">
                  We couldn't charge <strong style="font-weight:600;color:#0a0a0a;">${escapeHtml(data.amountFormatted)}</strong> for your SecureWarp <strong style="font-weight:600;color:#0a0a0a;">${escapeHtml(data.planLabel)}</strong> plan. ${escapeHtml(retryText)}
                </p>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.625;color:rgba(0,0,0,0.7);font-family:${SANS};">
                  Update your payment method before the next retry to keep your plan active. If the retry also fails, your account drops to the Free tier — <strong style="font-weight:600;color:#0a0a0a;">your files and data stay put.</strong>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 22px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${ALERT_BG};border:1px solid ${ALERT_BORDER};border-radius:8px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${ALERT};font-family:${MONO};">
                        What to do
                      </p>
                      <p style="margin:0;font-size:13px;line-height:1.55;color:#0a0a0a;font-family:${SANS};">
                        Open your drive, head to <strong style="font-weight:600;">Settings → Plan &amp; billing</strong>, and click <strong style="font-weight:600;">Update payment method</strong>. You'll land in Stripe's hosted form.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="background:${ALERT};border-radius:8px;">
                      <a href="${escapeAttr(data.portalUrl)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-size:12px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;font-family:${MONO};">
                        Update payment method →
                      </a>
                    </td>
                  </tr>
                </table>
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
                  Payment failure alerts are always sent — they can't be disabled in Settings. A silent failed charge would downgrade your plan without warning, which is worse than a duplicate email.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:24px 0 0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(0,0,0,0.42);font-family:${MONO};">
            Cloud storage, not cloud surveillance.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    "SECUREWARP · BETA",
    "[!] PAYMENT FAILED",
    "",
    greetingText,
    "",
    `We couldn't charge ${data.amountFormatted} for your SecureWarp ${data.planLabel} plan. ${retryText}`,
    "",
    "Update your payment method before the next retry to keep your plan active. If the retry also fails, your account drops to the Free tier — your files and data stay put.",
    "",
    "WHAT TO DO",
    "Open your drive, head to Settings → Plan & billing, and click Update payment method. You'll land in Stripe's hosted form.",
    "",
    `Update payment method: ${data.portalUrl}`,
    "",
    "---",
    "Payment failure alerts are always sent — they can't be disabled in Settings. A silent failed charge would downgrade your plan without warning, which is worse than a duplicate email.",
    "",
    "Cloud storage, not cloud surveillance.",
  ].join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
