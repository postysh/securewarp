import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { toggleStar } from "@/lib/db/files";
import { logError } from "@/lib/log";

const StarSchema = z.object({
  starred: z.boolean(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id: fileId } = await params;
    const body = await request.json();
    const parsed = StarSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }
    await toggleStar(fileId, session.userId, parsed.data.starred);
    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.star", err);
    return NextResponse.json({ error: "Star failed" }, { status: 500 });
  }
}
