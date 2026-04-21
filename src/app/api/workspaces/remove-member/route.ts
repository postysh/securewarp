import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { auditEvent } from "@/lib/audit";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { broadcast } from "@/lib/realtime/broadcast";
import { channelForUser } from "@/lib/realtime/channels";
import { logError } from "@/lib/log";

const Schema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
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

    // Owner check
    const { data: mem } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", session.userId)
      .single();
    if (!mem || mem.role !== "admin") {
      return NextResponse.json({ error: "Only the owner can remove members" }, { status: 403 });
    }

    // Can't remove yourself (use delete workspace instead)
    if (parsed.data.userId === session.userId) {
      return NextResponse.json({ error: "Cannot remove yourself" }, { status: 400 });
    }

    // Remove membership
    await supabase.from("workspace_members").delete()
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", parsed.data.userId);

    // Remove file_keys on the root folder
    const { data: ws } = await supabase.from("workspaces").select("root_folder_id").eq("id", parsed.data.workspaceId).single();
    if (ws) {
      await supabase.from("file_keys").delete()
        .eq("file_id", ws.root_folder_id)
        .eq("user_id", parsed.data.userId);
    }

    auditEvent({
      event: "workspace.remove",
      actorUserId: session.userId,
      targetUserId: parsed.data.userId,
      detail: parsed.data.workspaceId,
    });

    // Realtime nudge — the removed user's drive bounces them back
    // to personal drive + shows the banner without waiting for the
    // 20s workspace-list poll to detect the missing membership.
    await broadcast(channelForUser(parsed.data.userId), "workspace.member_removed", {
      workspaceId: parsed.data.workspaceId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("workspaces.remove-member", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
