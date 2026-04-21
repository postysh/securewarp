import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, adminAudit } from "@/lib/auth/admin";
import { supabase } from "@/lib/db/supabase";
import { getTier } from "@/lib/billing/customers";
import { logError } from "@/lib/log";

/**
 * Per-user entitlement overrides. Admins use this to stamp custom
 * limits onto a specific user without changing the global tier
 * definitions — enterprise quotes, goodwill storage bumps, bespoke
 * seat counts etc. The override is null-wins-wins: any column left
 * null inherits the user's Stripe tier default. Every entitlement
 * check in the app already reads through `getEntitlements`, so once
 * the row exists, the override is enforced immediately.
 *
 * The override is separate from Stripe billing. If the custom deal
 * has a custom price, the admin also configures that on Stripe's
 * side (dashboard → subscribe the user to a custom price) and mirrors
 * the number here via `price_cents_override` so the user's Plan panel
 * shows the right dollar amount.
 */
const UpsertSchema = z.object({
  tierLabelOverride: z.string().max(40).nullable().optional(),
  storageGbOverride: z.number().int().positive().max(1_000_000).nullable().optional(),
  seatsOverride: z.number().int().positive().max(10_000).nullable().optional(),
  workspacesOverride: z.number().int().positive().max(10_000).nullable().optional(),
  priceCentsOverride: z.number().int().min(0).max(10_000_000).nullable().optional(),
  // 1 TB hard ceiling. Per-file caps above this aren't realistic for
  // a browser-side chunked upload, and the higher bound also keeps
  // the admin UI's numeric input in a sane range.
  maxFileSizeBytesOverride: z.number().int().positive().max(1024 * 1024 * 1024 * 1024).nullable().optional(),
  // Version retention. `versionCount` is past versions kept beyond
  // the current one; `versionTtlDays` is the age cap on any past
  // version. 1000 / 3650 ceilings are defensive upper bounds — well
  // above any reasonable custom-deal value.
  versionCountOverride: z.number().int().positive().max(1000).nullable().optional(),
  versionTtlDaysOverride: z.number().int().positive().max(3650).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: targetId } = await params;
    const [{ data }, tier] = await Promise.all([
      supabase
        .from("user_entitlement_overrides")
        .select("*")
        .eq("user_id", targetId)
        .maybeSingle(),
      getTier(targetId),
    ]);
    // `isActive` reflects whether the override is actually being
    // applied right now. Tier-gating (see getEntitlements) means an
    // override on a Free-tier user is dormant — the row still exists,
    // but no entitlement check honors it. Admin UI uses this to show
    // a "Dormant" badge on the override card when relevant.
    return NextResponse.json({
      override: data ?? null,
      isActive: data != null && tier !== "free",
      tier,
    });
  } catch (err) {
    logError("admin.users.overrides.get", err);
    return NextResponse.json({ error: "Failed to load override" }, { status: 500 });
  }
}

/**
 * POST — upserts the override row. Any field omitted from the body
 * clears that column back to null (= inherit tier default). Sending
 * `{}` wipes every override. To fully remove an override, DELETE is
 * explicit and preferred.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id: targetId } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = UpsertSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    // Verify target user exists before inserting — the FK would catch
    // this anyway but the error body is kinder this way.
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("id", targetId)
      .maybeSingle();
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const payload = {
      user_id: targetId,
      tier_label_override: parsed.data.tierLabelOverride ?? null,
      storage_gb_override: parsed.data.storageGbOverride ?? null,
      seats_override: parsed.data.seatsOverride ?? null,
      workspaces_override: parsed.data.workspacesOverride ?? null,
      price_cents_override: parsed.data.priceCentsOverride ?? null,
      max_file_size_bytes_override: parsed.data.maxFileSizeBytesOverride ?? null,
      version_count_override: parsed.data.versionCountOverride ?? null,
      version_ttl_days_override: parsed.data.versionTtlDaysOverride ?? null,
      notes: parsed.data.notes ?? null,
      created_by_user_id: ctx.userId,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("user_entitlement_overrides")
      .upsert(payload, { onConflict: "user_id" })
      .select("*")
      .single();
    if (error) throw error;

    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "user.override.set",
      targetUserId: targetId,
      detail: JSON.stringify({
        tierLabel: payload.tier_label_override,
        storageGB: payload.storage_gb_override,
        seats: payload.seats_override,
        workspaces: payload.workspaces_override,
        priceCents: payload.price_cents_override,
        maxFileSizeBytes: payload.max_file_size_bytes_override,
        versionCount: payload.version_count_override,
        versionTtlDays: payload.version_ttl_days_override,
      }),
    });

    return NextResponse.json({ override: data });
  } catch (err) {
    logError("admin.users.overrides.set", err);
    return NextResponse.json({ error: "Failed to set override" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { id: targetId } = await params;
    const { error } = await supabase
      .from("user_entitlement_overrides")
      .delete()
      .eq("user_id", targetId);
    if (error) throw error;
    adminAudit({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      action: "user.override.clear",
      targetUserId: targetId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("admin.users.overrides.delete", err);
    return NextResponse.json({ error: "Failed to clear override" }, { status: 500 });
  }
}
