import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getFilesForUser } from "@/lib/db/files";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parentId = searchParams.get("parentId") || null;

    const files = await getFilesForUser(session.userId, parentId);

    return NextResponse.json({ files });
  } catch (err) {
    console.error("List files error:", err);
    return NextResponse.json({ error: "Failed to list files" }, { status: 500 });
  }
}
