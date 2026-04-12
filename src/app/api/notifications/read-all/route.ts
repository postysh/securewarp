import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { markAllNotificationsRead } from "@/lib/db/notifications";
import { logError } from "@/lib/log";

export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await markAllNotificationsRead(session.userId);
    return NextResponse.json({ success: true });
  } catch (err) {
    logError("notifications.read-all", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
