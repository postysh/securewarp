import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getFileById, grantFileAccess, getEffectivePermission } from "@/lib/db/files";
import { getPublicUserByEmail } from "@/lib/db/users";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { auditEvent } from "@/lib/audit";
import { createNotification } from "@/lib/db/notifications";
import { supabase } from "@/lib/db/supabase";
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

    // Caller must have access to this file — either a direct file_keys row
    // or inherited access via workspace parent chain. Non-owners can
    // re-share. Folders are allowed from Phase 3 onward: sharing a folder
    // grants access to every descendant via parent_keys_claim.
    let file = await getFileById(fileId, session.userId);
    if (!file) {
      const perm = await getEffectivePermission(fileId, session.userId);
      if (!perm || perm === "viewer") {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
    }

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

    // Check if the recipient already has access (re-share vs new share)
    const { data: existingKey } = await supabase
      .from("file_keys")
      .select("user_id")
      .eq("file_id", fileId)
      .eq("user_id", recipient.id)
      .single();
    const isNewShare = !existingKey;

    await grantFileAccess({
      fileId,
      userId: recipient.id,
      encryptedPrivateHierarchicalKey,
      wrappedByPublicKey,
      permissionLevel: permissionLevel ?? "editor",
    });

    auditEvent({
      event: "files.share",
      actorUserId: session.userId,
      targetUserId: recipient.id,
      targetFileId: fileId,
      detail: permissionLevel ?? "editor",
    });

    if (isNewShare) {
      createNotification({
        userId: recipient.id,
        type: "file_shared",
        title: "File shared with you",
        description: `${session.email} shared a file with you`,
        fileId,
        actorUserId: session.userId,
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
