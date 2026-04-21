/**
 * Upcoming renewal reminder — sent on invoice.upcoming webhook.
 *
 * Stripe fires this event a configurable number of days before the
 * invoice finalizes. Requires enabling the event on the Stripe
 * webhook endpoint (default is off). See the webhook handler comment
 * for the configuration step.
 *
 * Visual language matches the marketing site. Distinct from the
 * billing-receipt template: that one leads with the amount (you just
 * paid it); this one leads with the renewal date (the key "when" the
 * user needs to know to plan around).
 *
 * Zero-knowledge: plaintext fields only. See AGENTS.md → "Email".
 */

export interface BillingRenewalReminderData {
  displayName?: string | null;
  planLabel: string;
  amountFormatted: string;
  renewalDate: string;
  portalUrl: string;
}

const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

export function billingRenewalReminderTemplate(data: BillingRenewalReminderData): {
  subject: string;
  html: string;
  text: string;
} {
  const name = data.displayName?.trim() || null;
  const greetingText = name ? `Heads up, ${name}.` : "Heads up.";
  const greetingHtml = name ? `Heads up, ${escapeHtml(name)}.` : "Heads up.";
  const subject = `Upcoming renewal — ${data.amountFormatted} for SecureWarp ${data.planLabel} on ${data.renewalDate}`;

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
                  Upcoming renewal
                </p>
                <h1 style="margin:0 0 16px;font-size:28px;line-height:1.15;font-weight:400;letter-spacing:-0.6px;color:#0a0a0a;font-family:${SANS};">
                  ${greetingHtml}
                </h1>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.625;color:rgba(0,0,0,0.68);font-family:${SANS};">
                  Your SecureWarp plan renews in a few days. Nothing to do if you want to keep it going.
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
                            Renews on
                          </td>
                        </tr>
                        <tr>
                          <td style="font-size:24px;line-height:1.15;font-weight:500;color:#0a0a0a;font-family:${SANS};letter-spacing:-0.3px;">
                            ${escapeHtml(data.renewalDate)}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td width="50%" style="padding:14px 20px;border-right:1px solid rgba(0,0,0,0.06);">
                            <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(0,0,0,0.5);font-family:${MONO};">Plan</p>
                            <p style="margin:0;font-size:14px;color:#0a0a0a;font-family:${SANS};font-weight:500;">${escapeHtml(data.planLabel)}</p>
                          </td>
                          <td width="50%" style="padding:14px 20px;">
                            <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(0,0,0,0.5);font-family:${MONO};">Amount</p>
                            <p style="margin:0;font-size:14px;color:#0a0a0a;font-family:${SANS};font-weight:500;">${escapeHtml(data.amountFormatted)}</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 16px;">
                <p style="margin:0;font-size:14px;line-height:1.625;color:rgba(0,0,0,0.68);font-family:${SANS};">
                  Want to change plans, update your card, or cancel? Everything's in the billing portal.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="background:#ef5a3c;border-radius:8px;">
                      <a href="${escapeAttr(data.portalUrl)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-size:12px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;font-family:${MONO};">
                        Manage subscription →
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
                  You're receiving this because your SecureWarp subscription has an upcoming renewal. Turn off reminders in Settings → Notifications.
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
    "UPCOMING RENEWAL",
    "",
    greetingText,
    "",
    "Your SecureWarp plan renews in a few days. Nothing to do if you want to keep it going.",
    "",
    `Renews on: ${data.renewalDate}`,
    `Plan: ${data.planLabel}`,
    `Amount: ${data.amountFormatted}`,
    "",
    "Want to change plans, update your card, or cancel? Everything's in the billing portal.",
    "",
    `Manage subscription: ${data.portalUrl}`,
    "",
    "---",
    "You're receiving this because your SecureWarp subscription has an upcoming renewal. Turn off reminders in Settings → Notifications.",
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
