import "server-only";
import { Templates, type TemplateName, type TemplateData } from "./templates";
import { logError } from "@/lib/log";

/**
 * Single entry point for outbound email. See AGENTS.md → "Email".
 *
 * Zero-knowledge rules the caller must respect:
 *   - Template data types only include plaintext fields (email,
 *     display_name, workspace name, server-minted URLs). If a template
 *     needs a filename or any encrypted-blob-derived value, stop — that
 *     means something upstream decrypted on the server.
 *   - Fire-and-forget from request handlers: never block a user action on
 *     email provider latency or failure. Wrap with `sendEmail(...).catch(...)`
 *     and return the response immediately.
 *
 * Dev mode: when RESEND_API_KEY is unset (local dev, test env), this
 * logs a one-line summary and returns `{ ok: true, devNoOp: true }` so
 * you can develop without a provider account.
 *
 * Logs: never include recipient addresses or rendered bodies. We log the
 * template name and provider message id (on success) or error (on failure).
 */

export type EmailPayload = {
  [K in TemplateName]: {
    to: string;
    template: K;
    data: TemplateData[K];
  };
}[TemplateName];

export interface SendResult {
  ok: boolean;
  devNoOp?: boolean;
  providerMessageId?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<SendResult> {
  const { to, template, data } = payload;
  const renderFn = Templates[template] as (d: unknown) => {
    subject: string;
    html: string;
    text: string;
  };
  const { subject, html, text } = renderFn(data);

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "SecureWarp <onboarding@resend.dev>";
  const replyTo = process.env.EMAIL_REPLY_TO;

  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        ctx: `email.${template}`,
        devNoOp: true,
        recipientDomain: to.split("@")[1] ?? "unknown",
      })
    );
    return { ok: true, devNoOp: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      logError(`email.${template}`, {
        name: "ResendError",
        code: res.status,
        message: errBody.slice(0, 200),
      });
      return { ok: false };
    }

    const body = (await res.json().catch(() => ({}))) as { id?: string };
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        ctx: `email.${template}`,
        providerMessageId: body.id,
        recipientDomain: to.split("@")[1] ?? "unknown",
      })
    );
    return { ok: true, providerMessageId: body.id };
  } catch (err) {
    logError(`email.${template}`, err);
    return { ok: false };
  }
}
