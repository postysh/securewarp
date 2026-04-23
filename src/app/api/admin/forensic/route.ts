import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { findUserByEmail, getForensicBundle } from "@/lib/db/trust-safety";
import { logError } from "@/lib/log";

/**
 * GET /api/admin/forensic?email=foo@bar.com&download=1 — returns the
 * full forensic bundle for the user identified by email. When
 * `download=1` the response is served as a JSON attachment so an
 * admin can save it alongside a law-enforcement subpoena; otherwise
 * it's returned inline for the in-page preview.
 *
 * Bundle content is the same metadata we'd legally disclose under a
 * subpoena — it never includes decrypted file contents or filenames,
 * because we don't hold them. See `getForensicBundle` for the exact
 * shape.
 */

const QUERY = z.object({
  email: z.string().email(),
  download: z.enum(["0", "1"]).optional(),
});

export async function GET(request: Request) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const url = new URL(request.url);
    const parsed = QUERY.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const user = await findUserByEmail(parsed.data.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const bundle = await getForensicBundle(user.id, ctx.userId);
    if (!bundle) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "forensic.export",
      targetUserId: user.id,
      detail: `email=${parsed.data.email}`,
    });

    if (parsed.data.download === "1") {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const safeEmail = parsed.data.email.replace(/[^a-z0-9._-]/gi, "_");
      return new NextResponse(JSON.stringify(bundle, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="forensic-${safeEmail}-${ts}.json"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json(bundle);
  } catch (err) {
    logError("admin.forensic", err);
    return NextResponse.json({ error: "Forensic export failed" }, { status: 500 });
  }
}
