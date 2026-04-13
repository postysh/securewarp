import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { auditEvent } from "@/lib/audit";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { logError } from "@/lib/log";

const Schema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(["admin", "editor", "viewer"]),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await checkRateLimit(`ws:manage:${session.userId}`, 30))) {
      return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
    }

    const body = await request.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    // Only admins can change roles
    const { data: mem } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", session.userId)
      .single();
    if (!mem || mem.role !== "admin") {
      return NextResponse.json({ error: "Only admins can change roles" }, { status: 403 });
    }

    // Can't change your own role
    if (parsed.data.userId === session.userId) {
      return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
    }

    // Update the role
    const { error } = await supabase
      .from("workspace_members")
      .update({ role: parsed.data.role })
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", parsed.data.userId);
    if (error) throw error;

    // Also update the file_keys permission on the root folder
    const { data: ws } = await supabase
      .from("workspaces")
      .select("root_folder_id")
      .eq("id", parsed.data.workspaceId)
      .single();
    if (ws) {
      const filePermission = parsed.data.role === "viewer" ? "viewer" : "editor";
      await supabase
        .from("file_keys")
        .update({ permission_level: filePermission })
        .eq("file_id", ws.root_folder_id)
        .eq("user_id", parsed.data.userId);
    }

    auditEvent({
      event: "workspace.role_change",
      actorUserId: session.userId,
      targetUserId: parsed.data.userId,
      detail: `${parsed.data.role}:${parsed.data.workspaceId}`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("workspaces.change-role", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
