/**
 * Support message received by admin. Rendered as a simple
 * transactional-looking email so the admin reads it in any client.
 * No plaintext file content or encrypted-metadata fields — every
 * field here is already plaintext on the server (email,
 * user-typed subject, user-typed message).
 */

export interface SupportReceivedData {
  fromEmail: string;
  fromName: string | null;
  subject: string;
  message: string;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function supportReceivedTemplate(data: SupportReceivedData): {
  subject: string;
  html: string;
  text: string;
} {
  const fromLine = data.fromName
    ? `${data.fromName} <${data.fromEmail}>`
    : data.fromEmail;
  const subject = `Support: ${data.subject}`;
  const bodyHtml = escape(data.message).replace(/\n/g, "<br>");

  const html = `<!doctype html>
<html>
  <body style="font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; padding: 24px; margin: 0;">
    <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; padding: 28px; color: #111;">
      <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #888; margin-bottom: 8px;">New support message</div>
      <h1 style="font-size: 20px; margin: 0 0 18px; color: #111;">${escape(data.subject)}</h1>
      <div style="font-size: 13px; color: #555; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid #eee;">
        <div><strong>From:</strong> ${escape(fromLine)}</div>
      </div>
      <div style="font-size: 14px; line-height: 1.6; color: #222; white-space: pre-wrap;">${bodyHtml}</div>
      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; font-size: 12px; color: #888;">
        Reply to this email to respond directly to the user.
      </div>
    </div>
  </body>
</html>`;

  const text = `New support message

From: ${fromLine}
Subject: ${data.subject}

${data.message}

---
Reply to this email to respond directly to the user.`;

  return { subject, html, text };
}
