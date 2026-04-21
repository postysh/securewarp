import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { sendEmail, type EmailPayload } from "@/lib/email/send";
import { Templates, type TemplateName } from "@/lib/email/templates";
import { EMAIL_PREVIEW_FIXTURES } from "@/lib/email/preview-fixtures";
import { logError } from "@/lib/log";

/**
 * Dev-only endpoint that sends a real test email for any registered
 * template, using the shared preview fixtures as the payload.
 *
 * Gated two ways:
 *   1. `NODE_ENV === "production"` → 404. `process.env.NODE_ENV` is
 *      inlined by Next at build time, so the production bundle
 *      short-circuits here unconditionally. Defense in depth for the
 *      /app/dev layout gate — an API route isn't covered by that
 *      layout, so it needs its own check.
 *   2. `requireAdmin()` → 403 for any non-admin session. Prevents a
 *      malicious signed-in user on a staging/preview build from
 *      fanning out mail to arbitrary addresses.
 *
 * Pairs with /dev/emails — each preview page has a "Send test" form
 * that posts here.
 */

const BodySchema = z.object({
  template: z.string(),
  to: z.string().email(),
});

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const raw = await request.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { template, to } = parsed.data;
  if (!(template in Templates)) {
    return NextResponse.json({ error: "Unknown template" }, { status: 400 });
  }
  const name = template as TemplateName;
  const data = EMAIL_PREVIEW_FIXTURES[name];

  try {
    const res = await sendEmail({
      to,
      template: name,
      data,
    } as EmailPayload);
    return NextResponse.json({
      ok: res.ok,
      devNoOp: res.devNoOp ?? false,
      providerMessageId: res.providerMessageId ?? null,
    });
  } catch (err) {
    logError("dev.send-email", err);
    return NextResponse.json({ error: "Send failed" }, { status: 500 });
  }
}
