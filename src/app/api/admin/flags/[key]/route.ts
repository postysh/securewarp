import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { BOOL_FLAGS } from "@/lib/flags";
import { logError } from "@/lib/log";

const PatchSchema = z.object({
  // For bool flags. Extend when other types appear in BOOL_FLAGS' sister
  // catalogs.
  value: z.union([z.boolean(), z.string()]),
});

/**
 * Set a flag value. Upserts the app_settings row. Known bool-flag keys
 * are type-checked; unknown keys are rejected so a typo doesn't create
 * a phantom flag.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { key } = await params;
    const body = await request.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const def = BOOL_FLAGS.find((f) => f.key === key);
    if (!def) {
      return NextResponse.json({ error: "Unknown flag key" }, { status: 404 });
    }

    // Coerce to string for DB storage. Bool flags store 'true' | 'false'.
    let stringValue: string;
    if (typeof parsed.data.value === "boolean") {
      stringValue = parsed.data.value ? "true" : "false";
    } else {
      stringValue = parsed.data.value;
    }

    const { error } = await supabase.from("app_settings").upsert(
      {
        key,
        value: stringValue,
        description: def.description,
        updated_at: new Date().toISOString(),
        updated_by: ctx.userId,
        updated_by_email: ctx.email,
      },
      { onConflict: "key" }
    );
    if (error) throw error;

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "flag.set",
      detail: `${key}=${stringValue}`,
    });

    return NextResponse.json({ success: true, key, value: stringValue });
  } catch (err) {
    logError("admin.flags.patch", err);
    return NextResponse.json({ error: "Failed to update flag" }, { status: 500 });
  }
}
