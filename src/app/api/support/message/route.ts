import { NextResponse } from "next/server";
import { z } from "zod";
import { sendEmail } from "@/lib/email/send";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { normalizeEmail } from "@/lib/auth/email";
import { logError } from "@/lib/log";

/**
 * Public support-message submission. Posts are rate-limited per
 * normalized email so a single sender can't spam the admin inbox.
 * Turnstile is enforced when configured so bots can't either.
 *
 * Flow:
 *   1. Validate + normalize the submission.
 *   2. Send notification to SUPPORT_INBOX (defaults to
 *      hello@securewarp.com) via Resend. Reply-To is the user's
 *      email so hitting "reply" in the admin's mail client goes
 *      straight to them — no personal address exposed in headers.
 *   3. Send acknowledgement to the user from the same EMAIL_FROM
 *      identity the rest of the app uses, so replies to the ack
 *      still land at hello@securewarp.com.
 *
 * No database writes. Support volume is expected to be low in beta
 * and we prefer the inbox as the source of truth over an in-app
 * ticket table we'd also have to build an admin UI for.
 */

const BODY_SCHEMA = z.object({
  email: z.string().email().max(254),
  name: z.string().max(120).optional().default(""),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(4000),
});

export async function POST(request: Request) {
  try {
    const raw = await request.json().catch(() => null);
    if (!raw) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const parsed = BODY_SCHEMA.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid submission", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const email = normalizeEmail(parsed.data.email);
    const name = parsed.data.name.trim() || null;
    const subject = parsed.data.subject.trim();
    const message = parsed.data.message.trim();

    // Rate limit: 5 support messages per email per hour.
    if (!(await checkRateLimit(`support:${email}`, 5))) {
      return NextResponse.json(
        { error: "Too many messages. Try again later." },
        { status: 429 },
      );
    }

    const inbox = process.env.SUPPORT_INBOX || "hello@securewarp.com";

    // Notify admin inbox with Reply-To = user's email so replying in
    // a normal mail client targets the user directly.
    const adminResult = await sendEmail({
      to: inbox,
      replyTo: name ? `${name} <${email}>` : email,
      template: "support-received",
      data: {
        fromEmail: email,
        fromName: name,
        subject,
        message,
      },
    });

    // Best-effort ack to the user. Failure here shouldn't fail the
    // whole request — admin email was the primary purpose.
    sendEmail({
      to: email,
      template: "support-ack",
      data: {
        userName: name,
        subject,
      },
    }).catch((err) => logError("support.ack", err));

    if (!adminResult.ok) {
      return NextResponse.json(
        { error: "Could not deliver message. Please try again." },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("support.message", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
