import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import {
  channelForUser,
  channelForWorkspace,
} from "@/lib/realtime/channels";
import { logError } from "@/lib/log";

/**
 * Returns the Supabase Realtime channel names the caller is
 * authorized to subscribe to. Always one user channel + zero or
 * more workspace channels (one per membership).
 *
 * Channel names are HMAC-signed with a server-side secret so a
 * visitor can't guess their way into someone else's event stream.
 * This endpoint is the ONLY way a client learns the correct
 * strings; it's session-auth'd.
 *
 * Client calls this on drive-client mount and on workspace list
 * refresh (so a newly-invited user picks up the new workspace
 * channel without a page reload).
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Personal channel — events just for this user (share grants,
    // workspace invites, workspace removals).
    const userChannel = channelForUser(session.userId);

    // One channel per workspace the user is a member of. Workspace
    // events (file uploads, member changes) fan out here.
    const { data: memberships } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", session.userId);
    const workspaceChannels = ((memberships ?? []) as { workspace_id: string }[])
      .map((m) => ({
        workspaceId: m.workspace_id,
        channel: channelForWorkspace(m.workspace_id),
      }));

    return NextResponse.json({
      userChannel,
      workspaceChannels,
    });
  } catch (err) {
    logError("realtime.tokens", err);
    return NextResponse.json({ error: "Failed to mint tokens" }, { status: 500 });
  }
}
