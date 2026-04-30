import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * GET — list this user's enrolled passkeys (no key material). Used by
 * Settings → Security to render the credential cards and by the
 * post-enrollment prompt to know whether the user has a TOTP-only
 * vs passkey-only setup.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("user_passkeys")
      .select(
        "id, nickname, created_at, last_used_at, transports, is_backup_state",
      )
      .eq("user_id", session.userId)
      .order("created_at", { ascending: false });
    if (error) {
      logError("passkey.list", error);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    return NextResponse.json({ passkeys: data ?? [] });
  } catch (err) {
    logError("passkey.list", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
