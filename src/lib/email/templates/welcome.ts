/**
 * Welcome email — sent on successful signup.
 *
 * Zero-knowledge: this template takes NO user data beyond an optional
 * display name (plaintext on `users.display_name`). No filenames, no
 * content, no keys. See AGENTS.md → "Email".
 *
 * Visual language mirrors the marketing site: cream gutter, white
 * body column, hairline borders, warm-orange accent (`rgb(239,90,60)`,
 * the GREEN token from marketing-shell), uppercase mono eyebrows /
 * BETA pill. Email clients can't load Chillax, so the stack falls
 * through to system sans — the hierarchy still reads correctly.
 */

export interface WelcomeData {
  displayName?: string | null;
  driveUrl: string;
}

const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

export function welcomeTemplate(data: WelcomeData): {
  subject: string;
  html: string;
  text: string;
} {
  const trimmedName = data.displayName?.trim() || null;
  const greetingText = trimmedName ? `Welcome, ${trimmedName}` : "Welcome to SecureWarp";
  const greetingHtml = trimmedName
    ? `Welcome, ${escapeHtml(trimmedName)}`
    : "Welcome to SecureWarp";

  const subject = "Welcome to SecureWarp";

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
                  Account activated
                </p>
                <h1 style="margin:0 0 18px;font-size:30px;line-height:1.1;font-weight:400;letter-spacing:-0.8px;color:#0a0a0a;font-family:${SANS};">
                  ${greetingHtml}
                </h1>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.625;color:rgba(0,0,0,0.68);font-family:${SANS};">
                  Your account is ready. SecureWarp encrypts everything on your device before anything leaves it. We can't read your files, filenames, or password. No scanning, no backdoors, no keys on our side.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:rgba(239,90,60,0.06);border:1px solid rgba(239,90,60,0.18);border-radius:8px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#ef5a3c;font-family:${MONO};">
                        Keep this safe
                      </p>
                      <p style="margin:0;font-size:13px;line-height:1.55;color:#0a0a0a;font-family:${SANS};">
                        Your recovery phrase is the only way back in if you forget your password. Store it somewhere you won't lose it. We don't have a copy.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="background:#ef5a3c;border-radius:8px;">
                      <a href="${escapeAttr(data.driveUrl)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-size:12px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;font-family:${MONO};">
                        Open your drive →
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
                  You're receiving this because you created a SecureWarp account. This is a one-time welcome — we don't send marketing email.
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
    "ACCOUNT ACTIVATED",
    "",
    greetingText,
    "",
    "Your account is ready. SecureWarp encrypts everything on your device before anything leaves it. We can't read your files, filenames, or password. No scanning, no backdoors, no keys on our side.",
    "",
    "KEEP THIS SAFE",
    "Your recovery phrase is the only way back in if you forget your password. Store it somewhere you won't lose it. We don't have a copy.",
    "",
    `Open your drive: ${data.driveUrl}`,
    "",
    "---",
    "You're receiving this because you created a SecureWarp account. This is a one-time welcome — we don't send marketing email.",
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
