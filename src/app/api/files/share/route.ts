import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getFileById, grantFileAccess } from "@/lib/db/files";
import { getPublicUserByEmail } from "@/lib/db/users";
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

    const body = await request.json();
    const parsed = ShareSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid share data" }, { status: 400 });
    }
    const { fileId, recipientEmail, encryptedPrivateHierarchicalKey, wrappedByPublicKey, permissionLevel } = parsed.data;

    // Caller must hold a file_keys row for this file — enforces both access
    // and existence in one query. Non-owners can re-share. Folders are
    // allowed from Phase 3 onward: sharing a folder grants access to every
    // descendant via parent_keys_claim, so no per-child rows needed.
    const file = await getFileById(fileId, session.userId);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const recipient = await getPublicUserByEmail(recipientEmail);
    if (!recipient) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (recipient.id === session.userId) {
      return NextResponse.json(
        { error: "You already have access to this file" },
        { status: 400 }
      );
    }

    await grantFileAccess({
      fileId,
      userId: recipient.id,
      encryptedPrivateHierarchicalKey,
      wrappedByPublicKey,
      permissionLevel: permissionLevel ?? "editor",
    });

    return NextResponse.json({
      success: true,
      recipient: { userId: recipient.id, email: recipient.email },
    });
  } catch (err) {
    logError("files.share", err);
    return NextResponse.json({ error: "Share failed" }, { status: 500 });
  }
}
