import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { deleteBlob } from "@/lib/db/r2";
import { logError } from "@/lib/log";

const Schema = z.object({
  workspaceId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    // Only the workspace owner can delete
    const { data: wsCheck } = await supabase
      .from("workspaces")
      .select("owner_id")
      .eq("id", parsed.data.workspaceId)
      .single();
    if (!wsCheck || wsCheck.owner_id !== session.userId) {
      return NextResponse.json({ error: "Only the workspace owner can delete" }, { status: 403 });
    }

    // Get root folder ID
    const { data: ws } = await supabase
      .from("workspaces")
      .select("root_folder_id")
      .eq("id", parsed.data.workspaceId)
      .single();
    if (!ws) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Collect all files in the workspace for R2 cleanup
    const { data: wsFiles } = await supabase
      .from("files")
      .select("id, storage_key")
      .eq("workspace_id", parsed.data.workspaceId);
    const fileIds = (wsFiles || []).map((f) => f.id);

    const { data: chunks } = fileIds.length > 0
      ? await supabase.from("file_chunks").select("storage_key").in("file_id", fileIds)
      : { data: [] };

    const storageKeys = [
      ...(wsFiles || []).map((f) => f.storage_key).filter((k): k is string => !!k),
      ...((chunks || []).map((c) => c.storage_key as string)),
    ];

    // R2 cleanup (best-effort)
    await Promise.all(storageKeys.map(async (key) => {
      try { await deleteBlob(key); } catch { /* */ }
    }));

    // Delete workspace (cascades to workspace_members)
    await supabase.from("workspaces").delete().eq("id", parsed.data.workspaceId);

    // Unmark the root folder so it can be deleted, then delete it
    // (cascades to all children via parent_id FK ON DELETE CASCADE...
    // actually files don't have ON DELETE CASCADE on parent_id, so
    // delete all workspace files directly)
    if (fileIds.length > 0) {
      await supabase.from("files").delete().in("id", fileIds);
    }
    // Delete the root folder itself
    await supabase.from("files").delete().eq("id", ws.root_folder_id);

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("workspaces.delete", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
