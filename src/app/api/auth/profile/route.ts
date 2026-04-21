import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const UpdateSchema = z.object({
  displayName: z.string().max(100).optional(),
  // All known notification keys. Zod strips unknown fields by default,
  // so any new pref added in the UI MUST be added here too — otherwise
  // the toggle silently no-ops.
  notificationPrefs: z
    .object({
      file_shared: z.boolean().optional(),
      file_unshared: z.boolean().optional(),
      permission_changed: z.boolean().optional(),
      collaborator_joined: z.boolean().optional(),
      workspace_transferred: z.boolean().optional(),
      billing_receipts: z.boolean().optional(),
      billing_renewal_reminder: z.boolean().optional(),
    })
    .optional(),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data, error } = await supabase
      .from("users")
      .select("display_name, notification_prefs, onboarded_at, totp_secret, srp_salt, argon2_salt")
      .eq("id", session.userId)
      .single();
    if (error) throw error;
    return NextResponse.json({
      displayName: data?.display_name ?? "",
      notificationPrefs: data?.notification_prefs ?? {
        file_shared: true,
        file_unshared: true,
        permission_changed: true,
        collaborator_joined: true,
        workspace_transferred: true,
        billing_receipts: true,
        billing_renewal_reminder: true,
      },
      onboarded: data?.onboarded_at != null,
      totpEnabled: Boolean(data?.totp_secret),
      // Salts are NOT secrets — the server sends them during login
      // anyway. Exposed here so change-password can re-derive the
      // old verifier from the old password without a full SRP handshake.
      srpSalt: data?.srp_salt ?? null,
      argon2Salt: data?.argon2_salt ?? null,
    });
  } catch (err) {
    logError("auth.profile.get", err);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.displayName !== undefined) {
      updates.display_name = parsed.data.displayName.trim() || null;
    }
    if (parsed.data.notificationPrefs !== undefined) {
      // Merge with existing prefs
      const { data: current } = await supabase
        .from("users")
        .select("notification_prefs")
        .eq("id", session.userId)
        .single();
      const existing = (current?.notification_prefs as Record<string, boolean>) ?? {};
      updates.notification_prefs = { ...existing, ...parsed.data.notificationPrefs };
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from("users")
        .update(updates)
        .eq("id", session.userId);
      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("auth.profile.update", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
