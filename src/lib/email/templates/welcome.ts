/**
 * Welcome email — sent on successful signup.
 *
 * Zero-knowledge: this template takes NO user data beyond an optional
 * display name (plaintext on `users.display_name`). No filenames, no
 * content, no keys. See AGENTS.md → "Email".
 */

export interface WelcomeData {
  displayName?: string | null;
  driveUrl: string;
}

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
  <body style="margin:0;padding:0;background:#0a0a0a;color:#e5e5e5;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="520" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:#141414;border:1px solid #262626;border-radius:8px;padding:32px;">
            <tr><td>
              <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#fafafa;">${greetingHtml}</h1>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#a3a3a3;">
                Your account is ready. SecureWarp encrypts everything on your device before anything leaves it — we can't read your files, filenames, or password.
              </p>
              <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#a3a3a3;">
                A reminder: your recovery phrase is the only way back in if you forget your password. Store it somewhere safe.
              </p>
              <p style="margin:0 0 24px;">
                <a href="${escapeAttr(data.driveUrl)}" style="display:inline-block;padding:10px 16px;background:#fafafa;color:#0a0a0a;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">Open your drive</a>
              </p>
              <p style="margin:0;font-size:12px;color:#525252;">
                You're receiving this because you created a SecureWarp account. This is a one-time welcome; we don't send marketing email.
              </p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    greetingText,
    "",
    "Your account is ready. SecureWarp encrypts everything on your device before anything leaves it — we can't read your files, filenames, or password.",
    "",
    "A reminder: your recovery phrase is the only way back in if you forget your password. Store it somewhere safe.",
    "",
    `Open your drive: ${data.driveUrl}`,
    "",
    "You're receiving this because you created a SecureWarp account. This is a one-time welcome; we don't send marketing email.",
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
