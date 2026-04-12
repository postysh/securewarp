import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { markNotificationRead } from "@/lib/db/notifications";
import { logError } from "@/lib/log";

const ReadSchema = z.object({
  notificationId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const parsed = ReadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }
    await markNotificationRead(parsed.data.notificationId, session.userId);
    return NextResponse.json({ success: true });
  } catch (err) {
    logError("notifications.read", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
