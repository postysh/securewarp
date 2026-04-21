import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import {
  getOwnedFile,
  getDirectChildrenWithClaims,
  getCollaborators,
} from "@/lib/db/files";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { logError } from "@/lib/log";

const ParamSchema = z.object({ id: z.string().uuid() });

/**
 * Phase 5.1 — folder rotate context fetcher. Returns everything the
 * client needs in one roundtrip to perform a shallow folder rotation:
 *
 *   - The folder's own current hierarchical ciphertexts (so the client
 *     can look up its wrap for the owner, unwrap F.privHier, and walk
 *     direct children).
 *   - Every direct child's parent_keys_claim + public_hierarchical_key
 *     (the client walks those via the parent chain and re-wraps each
 *     child's claim under F's NEW pub hier key).
 *   - The current collaborator set (used to detect drift on commit
 *     and to build the new per-user priv-hier wraps).
 *
 * Owner-gated. Rate-limited. Rejects non-folders — for single files,
 * use the existing /rotate-init + /rotate-commit path.
 */
export async function GET(
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
    const parsed = ParamSchema.safeParse({ id });
    if (!parsed.success) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    const folder = await getOwnedFile(parsed.data.id, session.userId);
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    if (!folder.is_folder) {
      return NextResponse.json(
        { error: "Use /rotate-init for non-folder files" },
        { status: 400 }
      );
    }

    const [children, collaborators] = await Promise.all([
      getDirectChildrenWithClaims(folder.id),
      getCollaborators(folder.id),
    ]);

    return NextResponse.json({
      folder: {
        id: folder.id,
        parentId: folder.parent_id,
        publicHierarchicalKey: folder.public_hierarchical_key,
        publicKemHierarchicalKey: folder.public_kem_hierarchical_key,
        encryptedSessionKeyByFile: folder.encrypted_session_key_by_file,
        sessionKeyNonce: folder.session_key_nonce,
      },
      directChildren: children.map((c) => ({
        id: c.id,
        parentId: c.parent_id,
        isFolder: c.is_folder,
        publicHierarchicalKey: c.public_hierarchical_key,
        publicKemHierarchicalKey: c.public_kem_hierarchical_key,
        parentKeysClaim: c.parent_keys_claim,
        parentKeysClaimWrappedBy: c.parent_keys_claim_wrapped_by,
        encryptedSessionKeyByFile: c.encrypted_session_key_by_file,
        sessionKeyNonce: c.session_key_nonce,
      })),
      collaborators: collaborators.map((c) => ({
        userId: c.user_id,
        email: c.email,
        publicEncryptionKey: c.public_encryption_key,
        publicKemKey: c.public_kem_key,
        isOwner: c.is_owner,
        permissionLevel: c.permission_level,
      })),
    });
  } catch (err) {
    logError("files.folder-rotate-context", err);
    return NextResponse.json({ error: "Failed to load rotation context" }, { status: 500 });
  }
}
