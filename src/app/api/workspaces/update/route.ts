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

    const updates: Record<string, string> = {};
    if (parsed.data.color !== undefined) updates.color = parsed.data.color;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.defaultRole !== undefined) updates.default_role = parsed.data.defaultRole;

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
