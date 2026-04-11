import { NextResponse } from "next/server";
import { z } from "zod";
import { getLinkById } from "@/lib/db/files";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { anonymousRateLimitKey } from "@/lib/auth/link-access";
import { logError } from "@/lib/log";

const ParamSchema = z.object({ id: z.string().uuid() });

/**
 * Anonymous link metadata fetch. Returns everything an unauthenticated
 * visitor needs to perform the two-step client-side unwrap:
 *   1. Use linkKey (from URL fragment) to nacl.secretbox.open the wrapped
 *      private hierarchical key.
 *   2. Use the recovered priv hier key + owner's public key to
 *      nacl.box.open the session key wrapped to the file's pub hier key.
 *   3. Use the session key to decrypt metadata + content.
 *
 * NEVER returns file_keys rows or unrelated links. Collapses "not found",
 * "revoked", and "expired" into a single 404 to avoid leaking existence.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = ParamSchema.safeParse({ id });
    if (!parsed.success) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }

    if (!(await checkRateLimit(anonymousRateLimitKey(request, "link:get"), 300))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const payload = await getLinkById(parsed.data.id);
    if (!payload) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }

    const hasPassword = payload.link.password_salt !== null;
    return NextResponse.json({
      id: payload.link.id,
      fileId: payload.file.id,
      isFolder: payload.file.is_folder,
      encryptedPrivateHierarchicalKey: payload.link.encrypted_private_hierarchical_key,
      linkKeyNonce: payload.link.link_key_nonce,
      expiresAt: payload.link.expires_at,
      // Phase 4.1: when hasPassword is true, the visitor prompts for a
      // password, derives the wrapping key client-side via Argon2id +
      // passwordSalt, and unwraps `passwordWrappedLinkKey` to recover
      // the linkKey before proceeding with the normal two-step unwrap.
      // The URL fragment is empty for password-protected links.
      hasPassword,
      passwordSalt: payload.link.password_salt,
      passwordWrappedLinkKey: payload.link.password_wrapped_link_key,
      passwordWrapNonce: payload.link.password_wrap_nonce,
      file: {
        encryptedMetadata: payload.file.encrypted_metadata,
        publicHierarchicalKey: payload.file.public_hierarchical_key,
        encryptedSessionKeyByFile: payload.file.encrypted_session_key_by_file,
        sessionKeyNonce: payload.file.session_key_nonce,
        ownerPublicKey: payload.file.owner_public_key,
        sizeBytes: payload.file.size_bytes,
        chunkCount: payload.file.chunk_count,
      },
    });
  } catch (err) {
    logError("files.link.get", err);
    return NextResponse.json({ error: "Failed to fetch link" }, { status: 500 });
  }
}
