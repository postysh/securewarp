import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getFileById, createLink } from "@/lib/db/files";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { auditEvent } from "@/lib/audit";
import { logError } from "@/lib/log";

const CreateSchema = z
  .object({
    fileId: z.string().uuid(),
    // Combined b64(ciphertext) + separate b64(nonce) — the client wraps
    // the file's private hierarchical key with a random symmetric linkKey
    // via nacl.secretbox. The server never sees linkKey.
    encryptedPrivateHierarchicalKey: z.string().min(1),
    linkKeyNonce: z.string().min(1),
    // ISO timestamp. Optional — null means link never expires unless revoked.
    expiresAt: z.string().datetime().optional(),
    // Phase 4.1 password wrap. All three must be present or all absent.
    passwordSalt: z.string().min(1).optional(),
    passwordWrappedLinkKey: z.string().min(1).optional(),
    passwordWrapNonce: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      (v.passwordSalt === undefined &&
        v.passwordWrappedLinkKey === undefined &&
        v.passwordWrapNonce === undefined) ||
      (v.passwordSalt !== undefined &&
        v.passwordWrappedLinkKey !== undefined &&
        v.passwordWrapNonce !== undefined),
    { message: "Password fields must all be present or all absent" }
  );

/**
 * Any user who can decrypt a file (owner or collaborator) may create a
 * public link to it. The client, not the server, wraps the private hier
 * key under a freshly generated linkKey — the server only stores the
 * ciphertext and the nonce and has no way to materialize the plaintext.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await checkRateLimit(`link:create:${session.userId}`, 30))) {
      return NextResponse.json(
        { error: "Too many links created recently. Try again later." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid link data" }, { status: 400 });
    }

    // Access check — must currently hold a file_keys row. Matches the
    // Phase 2 re-share model: any collaborator can vend onwards.
    const file = await getFileById(parsed.data.fileId, session.userId);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const { id } = await createLink({
      fileId: parsed.data.fileId,
      createdBy: session.userId,
      encryptedPrivateHierarchicalKey: parsed.data.encryptedPrivateHierarchicalKey,
      linkKeyNonce: parsed.data.linkKeyNonce,
      expiresAt: parsed.data.expiresAt,
      passwordSalt: parsed.data.passwordSalt,
      passwordWrappedLinkKey: parsed.data.passwordWrappedLinkKey,
      passwordWrapNonce: parsed.data.passwordWrapNonce,
    });

    auditEvent({
      event: "link.create",
      actorUserId: session.userId,
      targetFileId: parsed.data.fileId,
      targetLinkId: id,
      detail: parsed.data.passwordSalt ? "password" : "public",
    });

    return NextResponse.json({ id });
  } catch (err) {
    logError("files.link.create", err);
    return NextResponse.json({ error: "Failed to create link" }, { status: 500 });
  }
}
