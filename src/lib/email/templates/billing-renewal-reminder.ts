/**
 * Upcoming renewal reminder — sent on invoice.upcoming webhook.
 *
 * Stripe fires this event a configurable number of days before the
 * invoice finalizes. Requires enabling the event on the Stripe
 * webhook endpoint (default is off). See the webhook handler comment
 * for the configuration step.
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

export function billingRenewalReminderTemplate(data: BillingRenewalReminderData): {
  subject: string;
  html: string;
  text: string;
} {
  const name = data.displayName?.trim() || null;
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const subject = `Upcoming renewal — ${data.amountFormatted} for SecureWarp ${data.planLabel} on ${data.renewalDate}`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0a;color:#e5e5e5;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="520" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:#141414;border:1px solid #262626;border-radius:8px;padding:32px;">
          <tr><td>
            <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#fafafa;">${escapeHtml(greeting)}</h1>
            <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#a3a3a3;">
              Your SecureWarp <strong style="color:#fafafa;">${escapeHtml(data.planLabel)}</strong> plan renews on <strong style="color:#fafafa;">${escapeHtml(data.renewalDate)}</strong> for <strong style="color:#fafafa;">${escapeHtml(data.amountFormatted)}</strong>. No action needed if you want to keep it going.
            </p>
            <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#a3a3a3;">
              Need to change plans, update your card, or cancel? Manage everything from the billing portal.
            </p>
            <p style="margin:0 0 24px;">
              <a href="${escapeAttr(data.portalUrl)}" style="display:inline-block;padding:10px 16px;background:#fafafa;color:#0a0a0a;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">Manage subscription</a>
            </p>
            <p style="margin:0;font-size:12px;color:#525252;">
              You're receiving this because your SecureWarp subscription has an upcoming renewal. Turn off reminders in Settings → Notifications.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    greeting,
    "",
    `Your SecureWarp ${data.planLabel} plan renews on ${data.renewalDate} for ${data.amountFormatted}. No action needed if you want to keep it going.`,
    "",
    "Need to change plans, update your card, or cancel? Manage everything from the billing portal.",
    "",
    `Manage subscription: ${data.portalUrl}`,
    "",
    "You're receiving this because your SecureWarp subscription has an upcoming renewal. Turn off reminders in Settings → Notifications.",
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
