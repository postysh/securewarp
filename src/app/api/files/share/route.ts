import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import {
  getFileWithEffectivePermission,
  grantFileAccess,
  type PermissionLevel,
} from "@/lib/db/files";
import { getPublicUserByEmail } from "@/lib/db/users";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { auditEvent } from "@/lib/audit";
import { createNotification, resolveActorLabel } from "@/lib/db/notifications";
import { supabase } from "@/lib/db/supabase";
import { broadcast } from "@/lib/realtime/broadcast";
import { channelForUser } from "@/lib/realtime/channels";
import { logError } from "@/lib/log";

const ShareSchema = z.object({
  fileId: z.string().uuid(),
  recipientEmail: z.string().email(),
  // base64(nonce‖ciphertext) — the file's *private hierarchical key*
  // wrapped to the recipient's public encryption key by the caller
  // (client-side nacl.box). Phase 2 change: we wrap the hierarchical priv
  // key, not the session key. The session key stays wrapped to the file's
  // public hier key and never gets re-wrapped.
  encryptedPrivateHierarchicalKey: z.string().min(1),
  // Sharer's public key at wrap time — the recipient needs it as the
  // box sender when they unwrap the row.
  wrappedByPublicKey: z.string().min(1),
  permissionLevel: z.enum(["editor", "viewer"]).optional(),
});

/**
 * Phase 2 share: any collaborator with access to a file can grant access
 * to someone else. The server gates on "does the caller have a file_keys
 * row" (via getFileById), not on ownership. The cryptographic story is
 * symmetric — collaborators hold the file's private hierarchical key and
 * can wrap it for new recipients just like the owner can.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Cap noisy share floods (e.g. a compromised session spamming
    // shares to enumerate accounts). 60/hour is generous for normal
    // usage and cheap to bump later.
    if (!(await checkRateLimit(`share:${session.userId}`, 60))) {
      return NextResponse.json(
        { error: "Too many share requests. Try again later." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const parsed = ShareSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid share data" }, { status: 400 });
    }
    const { fileId, recipientEmail, encryptedPrivateHierarchicalKey, wrappedByPublicKey, permissionLevel } = parsed.data;

    // Caller must have owner or editor access to this file — either a
    // direct file_keys row or inherited via the parent chain. Non-owners
    // can re-share (rule 4). Viewers cannot: the effective level is
    // computed unconditionally here, because a direct-row viewer would
    // otherwise pass a plain "has a file_keys row" check. Folders are
    // allowed from Phase 3 onward: sharing a folder grants access to
    // every descendant via parent_keys_claim.
    const access = await getFileWithEffectivePermission(fileId, session.userId);
    if (!access || access.permission === "viewer") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    const isOwner = access.permission === "owner";

    const recipient = await getPublicUserByEmail(recipientEmail);
    if (!recipient) {
      // Don't reveal whether the email exists — generic error
      return NextResponse.json({ error: "Share failed" }, { status: 400 });
    }
    if (recipient.id === session.userId) {
      return NextResponse.json(
        { error: "You already have access to this file" },
        { status: 400 }
      );
    }
    // The owner's row is the anchor for every access check on the file
    // (`getFilesForUser`, `getFileById`, the rotate guards). It must
    // never be rewritten through this endpoint — a collaborator could
    // otherwise replace the owner's wrapped private hier key with
    // garbage and demote them to viewer.
    if (recipient.id === access.file.owner_id) {
      return NextResponse.json(
        { error: "The owner already has full access to this file" },
        { status: 400 }
      );
    }

    // Check if the recipient already has access (re-share vs new share)
    const { data: existingKey } = await supabase
      .from("file_keys")
      .select("user_id, permission_level")
      .eq("file_id", fileId)
      .eq("user_id", recipient.id)
      .single();
    const isNewShare = !existingKey;

    // `grantFileAccess` is an upsert: on an existing row it rewrites the
    // wrapped key AND the permission level. Only the owner may do that
    // (permission changes are owner-only per rule 5 — `/permission` —
    // and this endpoint must not be a second, un-gated path to the same
    // effect). A non-owner re-share to someone who already has a row is
    // a no-op that reports success; it grants nothing new and it can't
    // clobber anyone's wrap.
    if (!isNewShare && !isOwner) {
      return NextResponse.json({
        success: true,
        alreadyShared: true,
        recipient: { userId: recipient.id, email: recipient.email },
      });
    }

    // On an owner re-share with no explicit level, KEEP the existing
    // level. Defaulting to "editor" here silently promoted viewers.
    const existingLevel = (existingKey?.permission_level as string | null | undefined) ?? null;
    const effectiveLevel: PermissionLevel =
      permissionLevel ??
      (existingLevel === "viewer" || existingLevel === "editor" ? existingLevel : "editor");

    await grantFileAccess({
      fileId,
      userId: recipient.id,
      encryptedPrivateHierarchicalKey,
      wrappedByPublicKey,
      permissionLevel: effectiveLevel,
    });

    auditEvent({
      event: "files.share",
      actorUserId: session.userId,
      targetUserId: recipient.id,
      targetFileId: fileId,
      detail: effectiveLevel,
    });

    if (isNewShare) {
      const actorLabel = await resolveActorLabel(session.userId, session.email);
      createNotification({
        userId: recipient.id,
        type: "file_shared",
        title: "File shared with you",
        description: `${actorLabel} shared a file with you`,
        fileId,
        actorUserId: session.userId,
      });
      // Realtime nudge — the recipient's drive refreshes without
      // waiting for the 20s poll to catch the new file_keys row.
      // Fire-and-forget; the notification row above is authoritative.
      await broadcast(channelForUser(recipient.id), "share.granted", {
        fileId,
      });
    }

    return NextResponse.json({
      success: true,
      recipient: { userId: recipient.id, email: recipient.email },
    });
  } catch (err) {
    logError("files.share", err);
    return NextResponse.json({ error: "Share failed" }, { status: 500 });
  }
}
