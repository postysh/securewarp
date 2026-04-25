/**
 * Recovery email setup — sent the moment a user opts into email
 * recovery. The single email does TWO jobs:
 *
 *   1. Confirm the user controls this inbox: a query-string token
 *      the confirm endpoint hashes and matches against a stored
 *      hash. Single-use, 7-day expiry.
 *
 *   2. Deliver the recovery URL the user must save: the recovery
 *      token lives in the URL fragment so it never leaves the
 *      user's browser. The user is told plainly that this email
 *      IS their backup — losing it is equivalent to never opting
 *      in.
 *
 * Zero-knowledge: takes only the recipient address (already
 * plaintext on `users.recovery_email`) and two server-minted URLs.
 * No filenames, no decrypted blobs, no key material. See AGENTS.md.
 */

export interface RecoveryEmailSetupData {
  confirmUrl: string;
  recoveryUrl: string;
}

const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

export function recoveryEmailSetupTemplate(data: RecoveryEmailSetupData): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = "Save this email. Your SecureWarp backup recovery";

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
                  Backup recovery
                </p>
                <h1 style="margin:0 0 18px;font-size:28px;line-height:1.15;font-weight:400;letter-spacing:-0.6px;color:#0a0a0a;font-family:${SANS};">
                  Save this email
                </h1>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.625;color:rgba(0,0,0,0.68);font-family:${SANS};">
                  This email contains your one time recovery URL. If you ever lose your password and your 24 word phrase, this is the only other way back into your account. We can't resend it. What's in this email is the only copy.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:rgba(239,90,60,0.06);border:1px solid rgba(239,90,60,0.18);border-radius:8px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#ef5a3c;font-family:${MONO};">
                        Step 1: confirm this address
                      </p>
                      <p style="margin:0 0 12px;font-size:13px;line-height:1.55;color:#0a0a0a;font-family:${SANS};">
                        Click below once to prove you control this inbox. The link expires in 7 days. After confirming, your recovery email is active.
                      </p>
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="background:#ef5a3c;border-radius:8px;">
                            <a href="${escapeAttr(data.confirmUrl)}" style="display:inline-block;padding:10px 20px;color:#ffffff;text-decoration:none;font-size:11px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;font-family:${MONO};">
                              Confirm address →
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fafafa;border:1px solid rgba(0,0,0,0.08);border-radius:8px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#0a0a0a;font-family:${MONO};">
                        Step 2: keep this URL forever
                      </p>
                      <p style="margin:0 0 12px;font-size:13px;line-height:1.55;color:rgba(0,0,0,0.68);font-family:${SANS};">
                        If you lose access, paste this exact URL on the recovery screen. Don't share it. Don't shorten it. The part after the # is your recovery key.
                      </p>
                      <p style="margin:0;font-size:11px;line-height:1.5;color:#0a0a0a;font-family:${MONO};word-break:break-all;background:#ffffff;border:1px solid rgba(0,0,0,0.08);border-radius:6px;padding:10px 12px;">
                        ${escapeHtml(data.recoveryUrl)}
                      </p>
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
                <p style="margin:0 0 8px;font-size:11px;line-height:1.6;color:rgba(0,0,0,0.44);font-family:${SANS};">
                  We never store the part of the URL after the #. Even with our database, an attacker can't decrypt your account using only what we hold.
                </p>
                <p style="margin:0;font-size:11px;line-height:1.6;color:rgba(0,0,0,0.44);font-family:${SANS};">
                  Didn't ask for this? Ignore the email. Without confirming, nothing changes on your account.
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
    "BACKUP RECOVERY",
    "",
    "Save this email.",
    "",
    "It contains your one time recovery URL. If you ever lose your password AND your 24 word phrase, this is the only other way back into your account. We can't resend it.",
    "",
    "STEP 1: CONFIRM THIS ADDRESS",
    "Click once to prove you control this inbox. Link expires in 7 days.",
    data.confirmUrl,
    "",
    "STEP 2: KEEP THIS URL FOREVER",
    "If you lose access, paste this exact URL on the recovery screen. Don't share it. Don't shorten it.",
    data.recoveryUrl,
    "",
    "---",
    "We never store the part of the URL after the #. Even with our database, an attacker can't decrypt your account using only what we hold.",
    "",
    "Didn't ask for this? Ignore the email. Without confirming, nothing changes on your account.",
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
