import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getOwnedFile } from "@/lib/db/files";
import { getUploadUrl, shardForChunk } from "@/lib/db/r2";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { logError } from "@/lib/log";

const ParamSchema = z.object({ id: z.string().uuid() });
const BodySchema = z.object({ chunkCount: z.number().int().positive().max(10000) });

/**
 * Phase 5 rotate-init — owner-gated. Returns a fresh set of presigned
 * URLs under brand-new R2 keys (distinct from the file's current chunk
 * prefix) so the client can upload new-session-key ciphertexts without
 * clobbering the currently-live blobs.
 *
 * No DB state changes here — this endpoint is a pure R2 signing helper.
 * The accompanying `/rotate-commit` endpoint performs the atomic swap.
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

    // Rotation is expensive (re-encrypts every chunk). Even a
    // legitimate user revoking a handful of collaborators should
    // never hit this limit, but it caps pathological loops.
    if (!(await checkRateLimit(`rotate:${session.userId}`, 20))) {
      return NextResponse.json(
        { error: "Too many rotation requests. Try again later." },
        { status: 429 }
      );
    }

    const { id } = await params;
    const parsedId = ParamSchema.safeParse({ id });
    if (!parsedId.success) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const file = await getOwnedFile(parsedId.data.id, session.userId);
    if (!file) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (file.is_folder) {
      // Folder rotation requires recursive parent_keys_claim re-wrapping
      // across every descendant — deferred to a later phase so the
      // single-file case ships without gotchas.
      return NextResponse.json(
        { error: "Folder rotation isn't supported yet" },
        { status: 400 }
      );
    }

    // Rotation version suffix distinguishes new blobs from the live
    // ones. Using a timestamp avoids collisions between back-to-back
    // rotations and keeps the key prefix debuggable.
    const version = Date.now().toString(36);
    const chunkUrls: { sequence: number; shard: number; storageKey: string; uploadUrl: string }[] = [];
    for (let i = 0; i < parsed.data.chunkCount; i++) {
      const shard = shardForChunk(i);
      const storageKey = `${session.userId}/${file.id}/v${version}/chunk-${i}`;
      const uploadUrl = await getUploadUrl(shard, storageKey);
      chunkUrls.push({ sequence: i, shard, storageKey, uploadUrl });
    }

    return NextResponse.json({ chunkUrls });
  } catch (err) {
    logError("files.rotate-init", err);
    return NextResponse.json({ error: "Failed to init rotate" }, { status: 500 });
  }
}
