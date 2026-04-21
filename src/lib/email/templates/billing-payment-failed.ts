/**
 * Payment failed — sent on invoice.payment_failed webhook.
 *
 * Bypasses notification prefs. A silent failed charge means the plan
 * downgrades to Free on the next retry cycle, with no chance for the
 * user to fix it. Treated as actionable/security-adjacent for that
 * reason — same bucket as password reset / new device alerts.
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

export function billingPaymentFailedTemplate(data: BillingPaymentFailedData): {
  subject: string;
  html: string;
  text: string;
} {
  const name = data.displayName?.trim() || null;
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const subject = `Action needed: payment failed for your SecureWarp ${data.planLabel} plan`;
  const retryLine = data.retryDate
    ? `We'll try again on ${data.retryDate}.`
    : "We'll retry automatically in the next few days.";

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0a;color:#e5e5e5;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="520" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:#141414;border:1px solid #262626;border-radius:8px;padding:32px;">
          <tr><td>
            <div style="display:inline-block;padding:4px 10px;background:rgba(239,90,60,0.12);border:1px solid rgba(239,90,60,0.3);color:#ef5a3c;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:16px;">Payment failed</div>
            <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#fafafa;">${escapeHtml(greeting)}</h1>
            <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#a3a3a3;">
              We couldn't charge <strong style="color:#fafafa;">${escapeHtml(data.amountFormatted)}</strong> for your SecureWarp <strong style="color:#fafafa;">${escapeHtml(data.planLabel)}</strong> plan. ${escapeHtml(retryLine)} If the retry also fails, your account will drop to the Free tier and your data stays put.
            </p>
            <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#a3a3a3;">
              Update your payment method before the next retry to keep your plan active.
            </p>
            <p style="margin:0 0 24px;">
              <a href="${escapeAttr(data.portalUrl)}" style="display:inline-block;padding:10px 16px;background:#ef5a3c;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">Update payment method</a>
            </p>
            <p style="margin:0;font-size:12px;color:#525252;">
              You're receiving this because a charge on your SecureWarp subscription failed. These alerts are always sent — they cannot be disabled because losing your plan silently would be worse than a duplicate notification.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    `[PAYMENT FAILED] ${greeting}`,
    "",
    `We couldn't charge ${data.amountFormatted} for your SecureWarp ${data.planLabel} plan. ${retryLine} If the retry also fails, your account will drop to the Free tier and your data stays put.`,
    "",
    "Update your payment method before the next retry to keep your plan active.",
    "",
    `Update payment method: ${data.portalUrl}`,
    "",
    "You're receiving this because a charge on your SecureWarp subscription failed. These alerts are always sent — they cannot be disabled because losing your plan silently would be worse than a duplicate notification.",
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
