import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const ALLOWED_COLORS = [
  "var(--accent-green-primary)",
  "var(--accent-blue-primary)",
  "var(--accent-pink-primary)",
  "var(--accent-orange-primary)",
  "var(--accent-yellow-primary)",
  "var(--accent-red-primary)",
];

const Schema = z.object({
  workspaceId: z.string().uuid(),
  color: z.string().refine((v) => ALLOWED_COLORS.includes(v)).optional(),
  description: z.string().max(200).optional(),
  defaultRole: z.enum(["admin", "editor", "viewer"]).optional(),
  // Security policy — see README migration block for the
  // enforcement map. All nullable/optional so partial updates from
  // the UI only touch what the admin changed.
  require2fa: z.boolean().optional(),
  linksDisabled: z.boolean().optional(),
  linksRequirePassword: z.boolean().optional(),
  // null explicitly clears the cap; undefined leaves it untouched.
  linksMaxExpiryDays: z
    .union([z.number().int().min(1).max(365), z.null()])
    .optional(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    // Admin check
    const { data: mem } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", session.userId)
      .single();
    if (!mem || mem.role !== "admin") {
      return NextResponse.json({ error: "Only admins can update settings" }, { status: 403 });
    }

    const updates: Record<string, string | boolean | number | null> = {};
    if (parsed.data.color !== undefined) updates.color = parsed.data.color;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.defaultRole !== undefined) updates.default_role = parsed.data.defaultRole;
    if (parsed.data.require2fa !== undefined) updates.require_2fa = parsed.data.require2fa;
    if (parsed.data.linksDisabled !== undefined) updates.links_disabled = parsed.data.linksDisabled;
    if (parsed.data.linksRequirePassword !== undefined) updates.links_require_password = parsed.data.linksRequirePassword;
    if (parsed.data.linksMaxExpiryDays !== undefined) updates.links_max_expiry_days = parsed.data.linksMaxExpiryDays;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { error } = await supabase
      .from("workspaces")
      .update(updates)
      .eq("id", parsed.data.workspaceId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("workspaces.update", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
