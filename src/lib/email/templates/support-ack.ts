/**
 * Auto-acknowledgement sent to the user who just submitted a
 * support request. Short, friendly, sets expectations. No plaintext
 * file-derived fields.
 *
 * Visual language matches the marketing site — same header, pills,
 * orange accent, mono eyebrows as the welcome and support-received
 * templates.
 */

export interface SupportAckData {
  userName: string | null;
  subject: string;
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

export function supportAckTemplate(data: SupportAckData): {
  subject: string;
  html: string;
  text: string;
} {
  const name = data.userName?.trim() || null;
  const greetingText = name ? `Hi ${name},` : "Hi there,";
  const greetingHtml = name ? `Hi ${escape(name)},` : "Hi there,";
  const subject = `We got your message: ${data.subject}`;

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
                  Message received
                </p>
                <h1 style="margin:0 0 18px;font-size:28px;line-height:1.15;font-weight:400;letter-spacing:-0.6px;color:#0a0a0a;font-family:${SANS};">
                  ${greetingHtml}
                </h1>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.625;color:rgba(0,0,0,0.68);font-family:${SANS};">
                  Thanks for reaching out. Your message came through and we'll reply within a day or two. A real person reads every ticket, so your patience helps.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 32px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:rgba(0,0,0,0.025);border:1px solid rgba(0,0,0,0.06);border-radius:8px;">
                  <tr>
                    <td style="padding:12px 16px;">
                      <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(0,0,0,0.5);font-family:${MONO};">
                        Your subject
                      </p>
                      <p style="margin:0;font-size:13px;line-height:1.5;color:#0a0a0a;font-family:${SANS};">
                        ${escape(data.subject)}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px;">
                <p style="margin:0;font-size:14px;line-height:1.625;color:rgba(0,0,0,0.68);font-family:${SANS};">
                  Need to add something? Reply to this email, or write to <a href="mailto:hello@securewarp.com" style="color:#ef5a3c;text-decoration:none;border-bottom:1px solid rgba(239,90,60,0.35);">hello@securewarp.com</a> directly.
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
                  — The SecureWarp team
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
    "MESSAGE RECEIVED",
    "",
    greetingText,
    "",
    "Thanks for reaching out. Your message came through and we'll reply within a day or two. A real person reads every ticket, so your patience helps.",
    "",
    `YOUR SUBJECT: ${data.subject}`,
    "",
    "Need to add something? Reply to this email, or write to hello@securewarp.com directly.",
    "",
    "---",
    "— The SecureWarp team",
    "",
    "Cloud storage, not cloud surveillance.",
  ].join("\n");

  return { subject, html, text };
}
