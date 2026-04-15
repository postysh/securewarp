import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * GET — return the user's backfill timestamps so the client can
 *       decide which passes to run on this session:
 *         indexedAt        → filename/folder index complete?
 *         contentIndexedAt → text/Office content backfill complete?
 *
 * POST — set the requested timestamps to now(). Body:
 *          { which: "names" | "content" }
 *        Idempotent.
 */

const POST_SCHEMA = z.object({
  which: z.enum(["names", "content"]),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data, error } = await supabase
      .from("users")
      .select("search_indexed_at, search_content_indexed_at")
      .eq("id", session.userId)
      .single();
    if (error) {
      logError("search.status.get", error);
      return NextResponse.json({ error: "Internal" }, { status: 500 });
    }
    return NextResponse.json({
      indexedAt: data?.search_indexed_at ?? null,
      contentIndexedAt: data?.search_content_indexed_at ?? null,
    });
  } catch (err) {
    logError("search.status.get", err);
    return NextResponse.json({ error: "Internal" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const parsed = POST_SCHEMA.safeParse(body);
    // Default to "names" for backwards compatibility with the original
    // POST shape (no body).
    const which = parsed.success ? parsed.data.which : "names";
    const column = which === "names" ? "search_indexed_at" : "search_content_indexed_at";
    const { error } = await supabase
      .from("users")
      .update({ [column]: new Date().toISOString() })
      .eq("id", session.userId);
    if (error) {
      logError("search.status.post", error);
      return NextResponse.json({ error: "Internal" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("search.status.post", err);
    return NextResponse.json({ error: "Internal" }, { status: 500 });
  }
}
