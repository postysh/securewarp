import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    throw new Error("Sentry test error — delete this route after verifying");
  } catch (e) {
    Sentry.captureException(e);
    await Sentry.flush(2000);
    return NextResponse.json({ error: "Test error sent to Sentry" }, { status: 500 });
  }
}
