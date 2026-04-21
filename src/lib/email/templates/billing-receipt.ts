/**
 * Billing receipt — sent on invoice.paid webhook.
 *
 * Zero-knowledge: takes no encrypted-blob-derived fields. Amount,
 * plan label, and dates come from Stripe (server-side billing
 * records) which never see user file content. Display name is
 * plaintext on `users.display_name`. See AGENTS.md → "Email".
 *
 * Visual language matches the marketing site — cream gutter, white
 * card, warm-orange accent, mono eyebrows / BETA pill. The amount
 * + plan sit in a prominent receipt block so the key data reads
 * at a glance in the inbox preview.
 */

export interface BillingReceiptData {
  displayName?: string | null;
  planLabel: string;
  amountFormatted: string;
  invoicePdfUrl?: string | null;
  nextRenewalDate?: string | null;
  portalUrl: string;
}

const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

export function billingReceiptTemplate(data: BillingReceiptData): {
  subject: string;
  html: string;
  text: string;
} {
  const name = data.displayName?.trim() || null;
  const greetingText = name ? `Thanks, ${name}.` : "Thanks for your payment.";
  const greetingHtml = name ? `Thanks, ${escapeHtml(name)}.` : "Thanks for your payment.";
  const subject = `Payment received — ${data.amountFormatted} for SecureWarp ${data.planLabel}`;
  const hasInvoice = !!data.invoicePdfUrl;

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
              <td style="padding:28px 32px 8px;">
                <p style="margin:0 0 12px;font-size:11px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:#ef5a3c;font-family:${MONO};">
                  Payment received
                </p>
                <h1 style="margin:0 0 16px;font-size:28px;line-height:1.15;font-weight:400;letter-spacing:-0.6px;color:#0a0a0a;font-family:${SANS};">
                  ${greetingHtml}
                </h1>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.625;color:rgba(0,0,0,0.68);font-family:${SANS};">
                  Your SecureWarp subscription is paid up. Details below for your records.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 22px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid rgba(0,0,0,0.08);border-radius:8px;">
                  <tr>
                    <td style="padding:18px 20px;border-bottom:1px solid rgba(0,0,0,0.06);">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(0,0,0,0.5);font-family:${MONO};padding-bottom:6px;">
                            Amount charged
                          </td>
                        </tr>
                        <tr>
                          <td style="font-size:32px;line-height:1;font-weight:500;color:#0a0a0a;font-family:${SANS};letter-spacing:-0.6px;">
                            ${escapeHtml(data.amountFormatted)}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td width="50%" style="padding:14px 20px;border-right:1px solid rgba(0,0,0,0.06);${data.nextRenewalDate ? "border-bottom:1px solid rgba(0,0,0,0.06);" : ""}">
                            <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(0,0,0,0.5);font-family:${MONO};">Plan</p>
                            <p style="margin:0;font-size:14px;color:#0a0a0a;font-family:${SANS};font-weight:500;">${escapeHtml(data.planLabel)}</p>
                          </td>
                          <td width="50%" style="padding:14px 20px;${data.nextRenewalDate ? "border-bottom:1px solid rgba(0,0,0,0.06);" : ""}">
                            <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(0,0,0,0.5);font-family:${MONO};">Billing cycle</p>
                            <p style="margin:0;font-size:14px;color:#0a0a0a;font-family:${SANS};">Monthly</p>
                          </td>
                        </tr>
                        ${data.nextRenewalDate ? `<tr>
                          <td colspan="2" style="padding:14px 20px;">
                            <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(0,0,0,0.5);font-family:${MONO};">Next renewal</p>
                            <p style="margin:0;font-size:14px;color:#0a0a0a;font-family:${SANS};">${escapeHtml(data.nextRenewalDate)}</p>
                          </td>
                        </tr>` : ""}
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="background:#ef5a3c;border-radius:8px;${hasInvoice ? "padding-right:8px;" : ""}">
                      <a href="${escapeAttr(data.portalUrl)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-size:12px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;font-family:${MONO};">
                        Manage billing →
                      </a>
                    </td>
                    ${hasInvoice ? `<td style="padding-left:10px;">
                      <a href="${escapeAttr(data.invoicePdfUrl!)}" style="display:inline-block;padding:12px 22px;color:#0a0a0a;text-decoration:none;font-size:12px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;font-family:${MONO};border:1px solid rgba(0,0,0,0.12);border-radius:8px;">
                        Download invoice
                      </a>
                    </td>` : ""}
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
                  You're receiving this because you have an active SecureWarp subscription. Turn off receipts in Settings → Notifications.
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
    "PAYMENT RECEIVED",
    "",
    greetingText,
    "",
    "Your SecureWarp subscription is paid up. Details below for your records.",
    "",
    `Amount charged: ${data.amountFormatted}`,
    `Plan: ${data.planLabel}`,
    "Billing cycle: Monthly",
    ...(data.nextRenewalDate ? [`Next renewal: ${data.nextRenewalDate}`] : []),
    "",
    `Manage billing: ${data.portalUrl}`,
    ...(data.invoicePdfUrl ? [`Download invoice: ${data.invoicePdfUrl}`] : []),
    "",
    "---",
    "You're receiving this because you have an active SecureWarp subscription. Turn off receipts in Settings → Notifications.",
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
