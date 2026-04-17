import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { createFeedback } from "@/lib/db/feedback";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

/**
 * POST /api/feedback — authenticated user submits feedback visible to
 * admins. Body is stored verbatim; no transformation, no enrichment.
 * Admin UI intentionally does NOT expose the submitter's email or
 * display name — feedback is anonymous to admins (user_id only, used
 * internally for rate limiting + abuse tracking, never rendered).
 */

const BODY = z.object({
  category: z.enum(["bug", "idea", "other"]),
  body: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = BODY.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid feedback" }, { status: 400 });
    }

    // Rate limit per user: 5 submissions per hour. Feedback spam would
    // waste admin attention and could be used to flood the table.
    if (!(await checkRateLimit(`feedback:${session.userId}`, 5))) {
      return NextResponse.json(
        { error: "Too many submissions. Try again later." },
        { status: 429 },
      );
    }

    await createFeedback({
      userId: session.userId,
      category: parsed.data.category,
      body: parsed.data.body,
    });

    // Audit event fires without the feedback body — that would defeat
    // the purpose of the dedicated table + anonymous-to-admins design.
    auditEvent({
      event: "feedback.submitted",
      actorUserId: session.userId,
      detail: parsed.data.category,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("feedback.submit", err);
    return NextResponse.json({ error: "Failed to submit feedback" }, { status: 500 });
  }
}
