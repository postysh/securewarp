/**
 * Support message received — forwarded to the admin support inbox
 * when a user submits the contact form. No plaintext file content or
 * encrypted-metadata fields; every field here is already plaintext on
 * the server (user's email, their typed subject + message).
 *
 * Visual language matches the marketing site (cream gutter, white
 * card, warm-orange accent, mono eyebrows / BETA pill) so the admin
 * inbox inherits the same brand voice as outbound user mail.
 */

export interface SupportReceivedData {
  fromEmail: string;
  fromName: string | null;
  subject: string;
  message: string;
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

export function supportReceivedTemplate(data: SupportReceivedData): {
  subject: string;
  html: string;
  text: string;
} {
  const fromName = data.fromName?.trim() || null;
  const fromLine = fromName
    ? `${fromName} <${data.fromEmail}>`
    : data.fromEmail;
  const subject = `Support: ${data.subject}`;
  const bodyHtml = escape(data.message).replace(/\n/g, "<br>");

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
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid rgba(0,0,0,0.06);border-radius:10px;">
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
                  Support message
                </p>
                <h1 style="margin:0 0 22px;font-size:24px;line-height:1.2;font-weight:400;letter-spacing:-0.4px;color:#0a0a0a;font-family:${SANS};">
                  ${escape(data.subject)}
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 20px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid rgba(0,0,0,0.06);border-radius:8px;">
                  <tr>
                    <td style="padding:12px 16px;border-bottom:1px solid rgba(0,0,0,0.06);">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(0,0,0,0.5);font-family:${MONO};width:80px;vertical-align:top;padding-top:2px;">
                            From
                          </td>
                          <td style="font-size:13px;color:#0a0a0a;font-family:${SANS};">
                            ${fromName ? `<strong style="font-weight:600;">${escape(fromName)}</strong> ` : ""}<span style="color:rgba(0,0,0,0.6);font-family:${MONO};font-size:12px;">${escape(data.fromEmail)}</span>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td style="display:none;"></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px;">
                <p style="margin:0 0 10px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(0,0,0,0.5);font-family:${MONO};">
                  Message
                </p>
                <div style="font-size:14px;line-height:1.625;color:#0a0a0a;font-family:${SANS};white-space:pre-wrap;">${bodyHtml}</div>
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
                  Hit reply to respond directly to ${fromName ? escape(fromName) : escape(data.fromEmail)}. Their email is set as the Reply-To on this message.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:24px 0 0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(0,0,0,0.42);font-family:${MONO};">
            Securewarp · Admin support inbox
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    "SECUREWARP · BETA",
    "SUPPORT MESSAGE",
    "",
    data.subject,
    "",
    `From: ${fromLine}`,
    "",
    "MESSAGE",
    data.message,
    "",
    "---",
    `Hit reply to respond directly to ${fromName ?? data.fromEmail}. Their email is set as the Reply-To on this message.`,
    "",
    "Securewarp · Admin support inbox",
  ].join("\n");

  return { subject, html, text };
}
