import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getOwnedFile } from "@/lib/db/files";
import { supabase } from "@/lib/db/supabase";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

const ParamSchema = z.object({ id: z.string().uuid() });

const FolderRowSchema = z.object({
  encryptedMetadata: z.string().min(1),
  publicHierarchicalKey: z.string().min(1),
  encryptedSessionKeyByFile: z.string().min(1),
  sessionKeyNonce: z.string().min(1),
  // F's own parent_keys_claim (re-wrapped if F has a parent, else null).
  parentKeysClaim: z.string().min(1).nullable().optional(),
  parentKeysClaimWrappedBy: z.string().min(1).nullable().optional(),
});

const RewrappedChildSchema = z.object({
  id: z.string().uuid(),
  parentKeysClaim: z.string().min(1),
  parentKeysClaimWrappedBy: z.string().min(1),
});

const CollaboratorSchema = z.object({
  userId: z.string().uuid(),
  encryptedPrivateHierarchicalKey: z.string().min(1),
  wrappedByPublicKey: z.string().min(1),
  permissionLevel: z.enum(["owner", "editor", "viewer"]),
});

const CommitSchema = z.object({
  folder: FolderRowSchema,
  rewrappedChildren: z.array(RewrappedChildSchema),
  remainingCollaborators: z.array(CollaboratorSchema),
  revokedUserId: z.string().uuid(),
});

/**
 * Phase 5.1 — folder shallow rotation commit.
 *
 * Atomically swaps the folder's own key material, re-wraps each direct
 * child's parent_keys_claim under the new folder pub hier, updates the
 * remaining collaborator's file_keys rows, and deletes the revoked
 * user's row. Descendants deeper than one level are untouched — their
 * claims are encrypted under their own (unchanged) parent's pub hier.
 *
 * Operation order is designed for idempotent retry:
 *   1. Update `files` row for F (new pub hier + session wrap)
 *   2. Upsert `file_keys` for remaining collaborators (new priv hier wrap)
 *   3. Update every direct child's `parent_keys_claim` / `_wrapped_by`
 *   4. Delete revoked user's `file_keys` row
 *
 * If any step crashes, the client can retry the exact same payload and
 * every step is idempotent. Between (2) and (3) the direct children's
 * claims briefly reference the OLD folder pub hier while F already has
 * the new one — a reader would fail to decrypt for the duration of the
 * gap (milliseconds). Documented in AGENTS.md.
 *
 * Invariants enforced server-side:
 * - Caller is the folder owner (is_folder = true).
 * - revokedUserId != caller.
 * - remainingCollaborators ∪ {revokedUserId} === current file_keys set (409).
 * - rewrappedChildren set === current direct-child set (no omissions,
 *   no extras, no grandchildren — prevents a client from updating
 *   unrelated rows via this endpoint).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await checkRateLimit(`rotate-folder:${session.userId}`, 20))) {
      return NextResponse.json(
        { error: "Too many rotation requests. Try again later." },
        { status: 429 }
      );
    }

    const { id } = await params;
    const parsedId = ParamSchema.safeParse({ id });
    if (!parsedId.success) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = CommitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid rotate payload" }, { status: 400 });
    }
    const data = parsed.data;

    const folder = await getOwnedFile(parsedId.data.id, session.userId);
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    if (!folder.is_folder) {
      return NextResponse.json(
        { error: "Use /rotate-commit for non-folder files" },
        { status: 400 }
      );
    }
    if (data.revokedUserId === session.userId) {
      return NextResponse.json(
        { error: "Cannot revoke yourself as the owner" },
        { status: 400 }
      );
    }

    // Guard 1: collaborator set equality.
    const { data: currentKeys, error: keysErr } = await supabase
      .from("file_keys")
      .select("user_id")
      .eq("file_id", folder.id);
    if (keysErr) throw keysErr;

    const currentUsers = new Set(
      ((currentKeys as { user_id: string }[]) ?? []).map((r) => r.user_id)
    );
    const proposedUsers = new Set<string>([
      ...data.remainingCollaborators.map((c) => c.userId),
      data.revokedUserId,
    ]);
    if (
      currentUsers.size !== proposedUsers.size ||
      [...currentUsers].some((u) => !proposedUsers.has(u))
    ) {
      return NextResponse.json(
        { error: "Collaborator set changed — retry with a fresh list" },
        { status: 409 }
      );
    }
    if (!currentUsers.has(data.revokedUserId)) {
      return NextResponse.json(
        { error: "User is not a collaborator on this folder" },
        { status: 400 }
      );
    }
    if (!data.remainingCollaborators.some((c) => c.userId === session.userId)) {
      return NextResponse.json(
        { error: "Owner must remain in the collaborator set" },
        { status: 400 }
      );
    }

    // Guard 2: rewrappedChildren set equality with direct-child set.
    // Also enforces that every id in the payload is actually a direct
    // child of this folder (prevents updating grandchildren or siblings).
    const { data: children, error: childrenErr } = await supabase
      .from("files")
      .select("id")
      .eq("parent_id", folder.id)
      .eq("upload_complete", true);
    if (childrenErr) throw childrenErr;

    const currentChildIds = new Set(
      ((children as { id: string }[]) ?? []).map((r) => r.id)
    );
    const proposedChildIds = new Set(data.rewrappedChildren.map((c) => c.id));
    if (currentChildIds.size !== proposedChildIds.size) {
      return NextResponse.json(
        {
          error:
            "Direct children set changed — retry with a fresh list",
        },
        { status: 409 }
      );
    }
    for (const cid of currentChildIds) {
      if (!proposedChildIds.has(cid)) {
        return NextResponse.json(
          { error: "Direct children set changed — retry with a fresh list" },
          { status: 409 }
        );
      }
    }

    // ── atomic-ish sequence ─────────────────────────────────────────
    // See the header comment for why this order is correct for
    // idempotent client retry after partial failure.

    // 1. Update folder row.
    const { error: folderErr } = await supabase
      .from("files")
      .update({
        encrypted_metadata: data.folder.encryptedMetadata,
        public_hierarchical_key: data.folder.publicHierarchicalKey,
        encrypted_session_key_by_file: data.folder.encryptedSessionKeyByFile,
        session_key_nonce: data.folder.sessionKeyNonce,
        parent_keys_claim: data.folder.parentKeysClaim ?? null,
        parent_keys_claim_wrapped_by: data.folder.parentKeysClaimWrappedBy ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", folder.id);
    if (folderErr) throw folderErr;

    // 2. Upsert remaining collaborators' new priv-hier wraps BEFORE
    //    touching child claims, so at all times at least one user can
    //    reach the folder's new keys.
    const { error: upsertErr } = await supabase.from("file_keys").upsert(
      data.remainingCollaborators.map((c) => ({
        file_id: folder.id,
        user_id: c.userId,
        encrypted_private_hierarchical_key: c.encryptedPrivateHierarchicalKey,
        wrapped_by_public_key: c.wrappedByPublicKey,
        permission_level: c.permissionLevel,
      })),
      { onConflict: "file_id,user_id" }
    );
    if (upsertErr) throw upsertErr;

    // 3. Rewrap each direct child's parent_keys_claim. Loop because
    //    PostgREST doesn't do per-row UPDATE in a single request; this
    //    is N statements but typical folders have ≤ few dozen direct
    //    children. For very large folders we'd switch to an RPC.
    for (const child of data.rewrappedChildren) {
      const { error: childErr } = await supabase
        .from("files")
        .update({
          parent_keys_claim: child.parentKeysClaim,
          parent_keys_claim_wrapped_by: child.parentKeysClaimWrappedBy,
          updated_at: new Date().toISOString(),
        })
        .eq("id", child.id)
        .eq("parent_id", folder.id); // defence-in-depth: never touch non-children
      if (childErr) throw childErr;
    }

    // 4. Delete revoked user last.
    const { error: revokeErr } = await supabase
      .from("file_keys")
      .delete()
      .eq("file_id", folder.id)
      .eq("user_id", data.revokedUserId);
    if (revokeErr) throw revokeErr;

    auditEvent({
      event: "files.rotate",
      actorUserId: session.userId,
      targetFileId: folder.id,
      targetUserId: data.revokedUserId,
      detail: `folder_shallow children=${data.rewrappedChildren.length} remaining=${data.remainingCollaborators.length}`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("files.rotate-folder-commit", err);
    return NextResponse.json({ error: "Rotate failed" }, { status: 500 });
  }
}
