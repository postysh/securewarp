/**
 * Billing receipt — sent on invoice.paid webhook.
 *
 * Zero-knowledge: takes no encrypted-blob-derived fields. Amount,
 * plan label, and dates come from Stripe (server-side billing
 * records) which never see user file content. Display name is
 * plaintext on `users.display_name`. See AGENTS.md → "Email".
 */

export interface BillingReceiptData {
  displayName?: string | null;
  planLabel: string;
  amountFormatted: string;
  invoicePdfUrl?: string | null;
  nextRenewalDate?: string | null;
  portalUrl: string;
}

export function billingReceiptTemplate(data: BillingReceiptData): {
  subject: string;
  html: string;
  text: string;
} {
  const name = data.displayName?.trim() || null;
  const greeting = name ? `Thanks, ${name}` : "Thanks for your payment";
  const subject = `Payment received — ${data.amountFormatted} for SecureWarp ${data.planLabel}`;
  const renewalLine = data.nextRenewalDate
    ? `Your next renewal is ${data.nextRenewalDate}.`
    : null;

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0a;color:#e5e5e5;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="520" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:#141414;border:1px solid #262626;border-radius:8px;padding:32px;">
          <tr><td>
            <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#fafafa;">${escapeHtml(greeting)}</h1>
            <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#a3a3a3;">
              We charged <strong style="color:#fafafa;">${escapeHtml(data.amountFormatted)}</strong> for your SecureWarp <strong style="color:#fafafa;">${escapeHtml(data.planLabel)}</strong> plan.
              ${renewalLine ? " " + escapeHtml(renewalLine) : ""}
            </p>
            <p style="margin:0 0 24px;">
              <a href="${escapeAttr(data.portalUrl)}" style="display:inline-block;padding:10px 16px;background:#fafafa;color:#0a0a0a;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">Manage billing</a>
              ${data.invoicePdfUrl ? `<a href="${escapeAttr(data.invoicePdfUrl)}" style="display:inline-block;margin-left:8px;padding:10px 16px;background:transparent;color:#fafafa;text-decoration:none;border:1px solid #404040;border-radius:6px;font-size:14px;font-weight:500;">Download invoice</a>` : ""}
            </p>
            <p style="margin:0;font-size:12px;color:#525252;">
              You're receiving this because you have an active SecureWarp subscription. Turn off receipts in Settings → Notifications.
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
    `We charged ${data.amountFormatted} for your SecureWarp ${data.planLabel} plan.${renewalLine ? " " + renewalLine : ""}`,
    "",
    `Manage billing: ${data.portalUrl}`,
    ...(data.invoicePdfUrl ? [`Download invoice: ${data.invoicePdfUrl}`] : []),
    "",
    "You're receiving this because you have an active SecureWarp subscription. Turn off receipts in Settings → Notifications.",
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
