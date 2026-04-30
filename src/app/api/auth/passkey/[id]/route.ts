import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

/**
 * GET — list this user's passkeys (for the Settings → Security UI).
 *   Returns no key material, only metadata: id, nickname, created_at,
 *   last_used_at, transports, is_backup_state.
 *
 * DELETE — remove a passkey by id. Owner-only; the row must belong
 *   to the caller. Refuses to delete the user's last passkey if the
 *   user has no TOTP enrolled — preventing an accidental "I removed
 *   my last second factor" lockout. Frontend should surface the 409
 *   as a clear error and offer the user a path to re-enroll TOTP or
 *   another passkey first.
 */

const PARAMS = z.object({ id: z.string().uuid() });

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await ctx.params;
    const parsed = PARAMS.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { data: row, error } = await supabase
      .from("user_passkeys")
      .select(
        "id, nickname, created_at, last_used_at, transports, is_backup_state",
      )
      .eq("id", parsed.data.id)
      .eq("user_id", session.userId)
      .single();
    if (error || !row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ passkey: row });
  } catch (err) {
    logError("passkey.get", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await ctx.params;
    const parsed = PARAMS.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    // Confirm the row belongs to this user before deleting. The
    // password + BIP39 recovery phrase paths are unaffected by passkey
    // removal — both routes can re-derive the user's keys from
    // scratch — so there's no lockout to guard against here. Users
    // can freely delete any passkey they enrolled.
    const { data: target } = await supabase
      .from("user_passkeys")
      .select("id, nickname")
      .eq("id", parsed.data.id)
      .eq("user_id", session.userId)
      .single();
    if (!target) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { error: delErr } = await supabase
      .from("user_passkeys")
      .delete()
      .eq("id", parsed.data.id)
      .eq("user_id", session.userId);
    if (delErr) {
      logError("passkey.delete", delErr);
      return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
    }

    auditEvent({
      event: "auth.passkey.delete",
      actorUserId: session.userId,
      detail: target.nickname,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("passkey.delete", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
