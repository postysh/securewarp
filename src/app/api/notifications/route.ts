import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getNotifications } from "@/lib/db/notifications";
import { logError } from "@/lib/log";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const notifications = await getNotifications(session.userId);
    return NextResponse.json({ notifications });
  } catch (err) {
    logError("notifications.list", err);
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 });
  }
}
