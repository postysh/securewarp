import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getFileById, createLink, getEffectivePermission } from "@/lib/db/files";
import { supabase } from "@/lib/db/supabase";
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

    // Access check — direct file_keys row or inherited via parent chain.
    // Matches Phase 2 re-share: any collaborator can vend onwards.
    const file = await getFileById(parsed.data.fileId, session.userId);
    if (!file) {
      const perm = await getEffectivePermission(parsed.data.fileId, session.userId);
      if (!perm || perm === "viewer") {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
    }

    // Workspace link-policy gate. Admins can:
    //   - disable public links entirely (links_disabled)
    //   - require a password on every link (links_require_password)
    //   - cap expiry at N days (links_max_expiry_days)
    // Enforced server-side here because the UI toggle alone isn't
    // load-bearing — a malicious client can bypass any client-only
    // check.
    const { data: policyFile } = await supabase
      .from("files")
      .select("workspace_id")
      .eq("id", parsed.data.fileId)
      .single();
    const workspaceId = policyFile?.workspace_id as string | null | undefined;
    if (workspaceId) {
      const { data: ws } = await supabase
        .from("workspaces")
        .select("links_disabled, links_require_password, links_max_expiry_days")
        .eq("id", workspaceId)
        .single();
      if (ws) {
        if (ws.links_disabled) {
          return NextResponse.json(
            { error: "Link sharing is disabled for this workspace" },
            { status: 403 },
          );
        }
        if (ws.links_require_password && !parsed.data.passwordSalt) {
          return NextResponse.json(
            { error: "This workspace requires a password on every public link" },
            { status: 400 },
          );
        }
        const maxDays = ws.links_max_expiry_days as number | null;
        if (maxDays) {
          if (!parsed.data.expiresAt) {
            return NextResponse.json(
              { error: `This workspace requires links to expire within ${maxDays} days` },
              { status: 400 },
            );
          }
          const maxAt = Date.now() + maxDays * 24 * 60 * 60 * 1000;
          if (new Date(parsed.data.expiresAt).getTime() > maxAt) {
            return NextResponse.json(
              { error: `Link expiry exceeds the workspace cap of ${maxDays} days` },
              { status: 400 },
            );
          }
        }
      }
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
