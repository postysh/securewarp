import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { normalizeEmail } from "@/lib/auth/email";
import { logError } from "@/lib/log";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");
    if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

    const normalized = normalizeEmail(email);
    const { data } = await supabase
      .from("users")
      .select("id, email, public_encryption_key")
      .eq("email", normalized)
      .single();
    if (!data) return NextResponse.json({ error: "User not found" }, { status: 404 });

    return NextResponse.json({
      userId: data.id,
      email: data.email,
      publicEncryptionKey: data.public_encryption_key,
    });
  } catch (err) {
    logError("users.lookup", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
