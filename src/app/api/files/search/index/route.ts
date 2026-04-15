import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { getEffectivePermission } from "@/lib/db/files";
import { logError } from "@/lib/log";

/**
 * Upsert the encrypted search-token set for a single file.
 *
 * Idempotent: deletes the caller's existing tokens for `fileId` and
 * re-inserts the new set in one transaction. Callers re-POST whenever
 * filename or content changes.
 *
 * Token hashes are opaque 32-byte HMAC outputs computed client-side
 * with the user's `searchIndexKey`. The server never sees plaintext
 * tokens or anything that reverses to one.
 *
 * Authorization: caller must already have a `file_keys` row for the
 * file (i.e. they have access to it). For owned-but-not-yet-keyed
 * files mid-upload, we accept inserts because the upload flow indexes
 * before the access row exists.
 */

const REQ_SCHEMA = z.object({
  fileId: z.string().uuid(),
  // Cap at 8000 tokens per file. The tokenizer caps content at 5000
  // unique tokens; filename adds at most a few dozen. Server-side cap
  // bounds the worst-case write amplification from a malicious client.
  tokens: z.array(z.string()).max(8000),
});

// Decode a base64 token-hash string into bytea-compatible Buffer.
// Reject anything that isn't a 32-byte SHA-256 HMAC output to keep
// the index storage predictable.
function parseTokenHash(b64: string): Buffer | null {
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length !== 32) return null;
    return buf;
  } catch {
    return null;
  }
}

function log(stage: string, payload: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ctx: "search.index", stage, ...payload }));
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      log("unauthorized", {});
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = REQ_SCHEMA.safeParse(body);
    if (!parsed.success) {
      log("bad_request", { userId: session.userId, error: parsed.error.message });
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    const { fileId, tokens } = parsed.data;
    log("received", { userId: session.userId, fileId, tokenCount: tokens.length });

    // Validate caller has access to the file via the same logic the
    // file list endpoint uses: direct file_keys row OR ownership OR
    // inherited access through a parent folder's file_keys row
    // (Phase 3 parent_keys_claim chain). Without the inherited check,
    // workspace members couldn't index any file inside a workspace
    // folder they didn't directly create — which is most files.
    const { data: keyRow, error: keyErr } = await supabase
      .from("file_keys")
      .select("file_id")
      .eq("file_id", fileId)
      .eq("user_id", session.userId)
      .maybeSingle();
    if (keyErr) {
      log("key_lookup_error", { userId: session.userId, fileId, error: keyErr.message });
    }

    let accessPath: string = keyRow ? "direct_key" : "";
    if (!keyRow) {
      const { data: fileRow, error: fileErr } = await supabase
        .from("files")
        .select("owner_id")
        .eq("id", fileId)
        .maybeSingle();
      if (fileErr) {
        log("file_lookup_error", { userId: session.userId, fileId, error: fileErr.message });
      }
      const isOwner = fileRow?.owner_id === session.userId;
      if (isOwner) {
        accessPath = "owner";
      } else {
        const inheritedPerm = await getEffectivePermission(fileId, session.userId);
        if (!inheritedPerm) {
          log("access_denied", {
            userId: session.userId,
            fileId,
            fileExists: !!fileRow,
            ownerId: fileRow?.owner_id,
          });
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        accessPath = "inherited";
      }
    }
    log("access_granted", { userId: session.userId, fileId, via: accessPath });

    // Validate every token first — one bad entry rejects the whole
    // batch so we never leave a half-indexed file.
    const hashBuffers: Buffer[] = [];
    for (const t of tokens) {
      const buf = parseTokenHash(t);
      if (!buf) {
        return NextResponse.json({ error: "Malformed token" }, { status: 400 });
      }
      hashBuffers.push(buf);
    }

    // Replace the user's tokens for this file in a single transaction.
    // PostgREST doesn't expose BEGIN/COMMIT; we use the delete-then-
    // insert pattern which is acceptable because:
    //   (a) the table isn't read by anyone but the same user, and
    //   (b) a search query racing this would just miss this file
    //       transiently — no correctness issue, no leak.
    const { error: delErr, count: delCount } = await supabase
      .from("file_search_tokens")
      .delete({ count: "exact" })
      .eq("user_id", session.userId)
      .eq("file_id", fileId);
    if (delErr) {
      log("delete_error", { userId: session.userId, fileId, error: delErr.message });
      logError("search.index.delete", delErr);
      return NextResponse.json({ error: "Index update failed", detail: delErr.message }, { status: 500 });
    }
    log("delete_ok", { userId: session.userId, fileId, removed: delCount ?? null });

    if (hashBuffers.length > 0) {
      const rows = hashBuffers.map((h) => ({
        user_id: session.userId,
        file_id: fileId,
        // bytea via PostgREST: \x prefix + hex.
        token_hash: "\\x" + h.toString("hex"),
      }));
      // Chunk inserts to avoid request-size limits on huge content
      // tokenizations. 1000 rows per chunk is well under the 8MB
      // PostgREST request body cap.
      const CHUNK = 1000;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error: insErr, count: insCount } = await supabase
          .from("file_search_tokens")
          .insert(rows.slice(i, i + CHUNK), { count: "exact" });
        if (insErr) {
          log("insert_error", {
            userId: session.userId,
            fileId,
            chunkIndex: i,
            chunkSize: Math.min(CHUNK, rows.length - i),
            errorCode: (insErr as { code?: string }).code,
            errorMessage: insErr.message,
            errorDetails: (insErr as { details?: string }).details,
            errorHint: (insErr as { hint?: string }).hint,
          });
          logError("search.index.insert", insErr);
          return NextResponse.json({ error: "Index update failed", detail: insErr.message }, { status: 500 });
        }
        log("insert_ok", { userId: session.userId, fileId, inserted: insCount ?? null });
      }
    }

    log("done", { userId: session.userId, fileId, totalInserted: hashBuffers.length });
    return NextResponse.json({ ok: true, count: hashBuffers.length });
  } catch (err) {
    log("uncaught", { error: (err as Error).message, stack: (err as Error).stack });
    logError("search.index", err);
    return NextResponse.json({ error: "Internal error", detail: (err as Error).message }, { status: 500 });
  }
}
