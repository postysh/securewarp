import { NextResponse } from "next/server";

export async function GET() {
  throw new Error("Sentry Server Test Error");
  return NextResponse.json({ ok: true });
}
