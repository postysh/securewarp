import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

const QuerySchema = z.object({ workspaceId: z.string().uuid() });

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({ workspaceId: searchParams.get("workspaceId") });
    if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

    // Admin check
    const { data: mem } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("user_id", session.userId)
      .single();
    if (!mem || mem.role !== "admin") {
      return NextResponse.json({ error: "Only admins can view activity" }, { status: 403 });
    }

    // Get all file IDs in this workspace
    const { data: wsFiles } = await supabase
      .from("files")
      .select("id")
      .eq("workspace_id", parsed.data.workspaceId);
    const fileIds = (wsFiles || []).map((f) => f.id);

    // Fetch audit events for workspace files + workspace-specific events
    let events: {
      id: string;
      event_type: string;
      actor_user_id: string | null;
      target_user_id: string | null;
      target_file_id: string | null;
      detail: string | null;
      occurred_at: string;
    }[] = [];

    if (fileIds.length > 0) {
      const { data, error } = await supabase
        .from("security_audit")
        .select("id, event_type, actor_user_id, target_user_id, target_file_id, detail, occurred_at")
        .in("target_file_id", fileIds)
        .order("occurred_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      events = data || [];
    }

    // Also fetch workspace-specific events (transfers, etc.)
    const { data: wsEvents } = await supabase
      .from("security_audit")
      .select("id, event_type, actor_user_id, target_user_id, target_file_id, detail, occurred_at")
      .like("detail", `%${parsed.data.workspaceId}%`)
      .order("occurred_at", { ascending: false })
      .limit(20);

    // Merge and dedupe
    const seen = new Set(events.map((e) => e.id));
    for (const e of wsEvents || []) {
      if (!seen.has(e.id)) {
        events.push(e);
        seen.add(e.id);
      }
    }
    events.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
    events = events.slice(0, 50);

    // Resolve actor emails
    const userIds = new Set<string>();
    for (const e of events) {
      if (e.actor_user_id) userIds.add(e.actor_user_id);
      if (e.target_user_id) userIds.add(e.target_user_id);
    }
    const { data: users } = userIds.size > 0
      ? await supabase.from("users").select("id, email").in("id", [...userIds])
      : { data: [] };
    const emailMap = new Map((users || []).map((u) => [u.id, u.email as string]));

    // Resolve file metadata for target files — include encrypted_metadata
    // so the client can decrypt file names
    const targetFileIds = [...new Set(events.map((e) => e.target_file_id).filter(Boolean))] as string[];
    const { data: fileRows } = targetFileIds.length > 0
      ? await supabase.from("files").select("id, is_folder, encrypted_metadata, encrypted_session_key_by_file, session_key_nonce, public_hierarchical_key, owner_id").in("id", targetFileIds)
      : { data: [] };
    const fileMetaMap = new Map((fileRows || []).map((f) => [f.id as string, {
      isFolder: f.is_folder as boolean,
      encryptedMetadata: f.encrypted_metadata as string | null,
      encryptedSessionKeyByFile: f.encrypted_session_key_by_file as string | null,
      sessionKeyNonce: f.session_key_nonce as string | null,
      publicHierarchicalKey: f.public_hierarchical_key as string | null,
      ownerId: f.owner_id as string,
    }]));

    // Resolve owner public keys for file decryption
    const ownerIds = [...new Set([...fileMetaMap.values()].map((f) => f.ownerId).filter(Boolean))];
    const { data: ownerKeyRows } = ownerIds.length > 0
      ? await supabase.from("users").select("id, public_encryption_key").in("id", ownerIds)
      : { data: [] };
    const ownerKeyMap = new Map((ownerKeyRows || []).map((u) => [u.id, u.public_encryption_key as string]));

    return NextResponse.json({
      events: events.map((e) => {
        const fileMeta = e.target_file_id ? fileMetaMap.get(e.target_file_id) : null;
        return {
          id: e.id,
          type: e.event_type,
          actorEmail: e.actor_user_id ? emailMap.get(e.actor_user_id) ?? null : null,
          targetEmail: e.target_user_id ? emailMap.get(e.target_user_id) ?? null : null,
          targetFileId: e.target_file_id,
          targetIsFolder: fileMeta?.isFolder ?? null,
          // Encrypted file metadata for client-side name decryption
          encryptedMetadata: fileMeta?.encryptedMetadata ?? null,
          encryptedSessionKeyByFile: fileMeta?.encryptedSessionKeyByFile ?? null,
          sessionKeyNonce: fileMeta?.sessionKeyNonce ?? null,
          publicHierarchicalKey: fileMeta?.publicHierarchicalKey ?? null,
          ownerPublicKey: fileMeta ? ownerKeyMap.get(fileMeta.ownerId) ?? null : null,
          detail: e.detail,
          createdAt: e.occurred_at,
        };
      }),
    });
  } catch (err) {
    logError("workspaces.activity", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
