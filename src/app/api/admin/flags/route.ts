import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { BOOL_FLAGS } from "@/lib/flags";
import { logError } from "@/lib/log";

/**
 * List all known flags with their current value. Merges the catalog
 * in src/lib/flags.ts (known keys + defaults + descriptions) with
 * whatever's in the app_settings table, so the UI shows defaults
 * even when a row hasn't been seeded.
 */
export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { data: rows, error } = await supabase
      .from("app_settings")
      .select("key, value, description, updated_at, updated_by_email");
    if (error) throw error;

    const byKey = new Map(
      (rows ?? []).map((r) => [r.key as string, r as {
        key: string;
        value: string;
        description: string | null;
        updated_at: string;
        updated_by_email: string | null;
      }])
    );

    // Return one entry per catalog flag. Add any DB-only rows at the
    // end (future flags registered in SQL but not yet pushed to the
    // catalog).
    const catalogKeys = new Set(BOOL_FLAGS.map((f) => f.key));
    const flags = [
      ...BOOL_FLAGS.map((f) => {
        const row = byKey.get(f.key);
        return {
          key: f.key,
          type: "bool" as const,
          value: row ? row.value === "true" : f.defaultValue,
          defaultValue: f.defaultValue,
          description: row?.description ?? f.description,
          updatedAt: row?.updated_at ?? null,
          updatedByEmail: row?.updated_by_email ?? null,
        };
      }),
      ...[...byKey.values()]
        .filter((r) => !catalogKeys.has(r.key))
        .map((r) => ({
          key: r.key,
          type: "unknown" as const,
          value: r.value,
          defaultValue: null,
          description: r.description ?? null,
          updatedAt: r.updated_at,
          updatedByEmail: r.updated_by_email ?? null,
        })),
    ];

    return NextResponse.json({ flags });
  } catch (err) {
    logError("admin.flags.list", err);
    return NextResponse.json({ error: "Failed to load flags" }, { status: 500 });
  }
}
