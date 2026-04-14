import { NextResponse } from "next/server";
import { getBoolFlag } from "@/lib/flags";
import { logError } from "@/lib/log";

/**
 * Public config endpoint. Returns only the subset of flags that
 * unauthenticated callers need to know (signup availability). Do NOT
 * surface internal flags like `uploads_enabled` here — that's a hint
 * about what's wrong without logging in, and there's no legitimate
 * non-authenticated caller that needs it.
 */
export async function GET() {
  try {
    const [signupsEnabled] = await Promise.all([getBoolFlag("signups_enabled")]);
    return NextResponse.json({ signupsEnabled });
  } catch (err) {
    logError("config.public", err);
    // Fail open: treat missing config as "signups on" so a transient
    // DB blip doesn't lock legitimate users out of registration.
    return NextResponse.json({ signupsEnabled: true });
  }
}
