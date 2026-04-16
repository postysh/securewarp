/**
 * Auto-acknowledgement sent to the user who just submitted a
 * support request. Short, friendly, sets expectations. No
 * plaintext file-derived fields.
 */

export interface SupportAckData {
  userName: string | null;
  subject: string;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function supportAckTemplate(data: SupportAckData): {
  subject: string;
  html: string;
  text: string;
} {
  const greeting = data.userName ? `Hi ${data.userName},` : "Hi,";
  const subject = `We got your message: ${data.subject}`;

  const html = `<!doctype html>
<html>
  <body style="font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; padding: 24px; margin: 0;">
    <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; color: #111;">
      <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #04a45c; margin-bottom: 10px;">SecureWarp Support</div>
      <h1 style="font-size: 22px; margin: 0 0 18px; color: #111;">${escape(greeting)}</h1>
      <p style="font-size: 15px; line-height: 1.6; color: #333; margin: 0 0 14px;">
        Thanks for reaching out. Your message came through and we&#39;ll reply
        within a day or two.
      </p>
      <p style="font-size: 15px; line-height: 1.6; color: #333; margin: 0 0 14px;">
        If you need to add anything, reply to this email or write to
        <a href="mailto:hello@securewarp.com" style="color: #04a45c; text-decoration: none;">hello@securewarp.com</a> directly.
      </p>
      <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #eee; font-size: 12px; color: #888;">
        — The SecureWarp team
      </div>
    </div>
  </body>
</html>`;

  const text = `${greeting}

Thanks for reaching out. Your message came through and we'll reply within a day or two.

If you need to add anything, reply to this email or write to hello@securewarp.com directly.

— The SecureWarp team`;

  return { subject, html, text };
}
