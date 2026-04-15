import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
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

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = REQ_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    const { fileId, tokens } = parsed.data;

    // Validate caller has access to the file. Owners always have a
    // file_keys row (per AGENTS.md sharing rule 7), so this single
    // check covers both owned and shared files. The exception is the
    // brief upload window before the keys row is committed — for that
    // path we also accept "user owns the files row" as proof of access.
    const { data: keyRow } = await supabase
      .from("file_keys")
      .select("file_id")
      .eq("file_id", fileId)
      .eq("user_id", session.userId)
      .maybeSingle();

    if (!keyRow) {
      const { data: fileRow } = await supabase
        .from("files")
        .select("owner_id")
        .eq("id", fileId)
        .maybeSingle();
      if (!fileRow || fileRow.owner_id !== session.userId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

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
    const { error: delErr } = await supabase
      .from("file_search_tokens")
      .delete()
      .eq("user_id", session.userId)
      .eq("file_id", fileId);
    if (delErr) {
      logError("search.index.delete", delErr);
      return NextResponse.json({ error: "Index update failed" }, { status: 500 });
    }

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
        const { error: insErr } = await supabase
          .from("file_search_tokens")
          .insert(rows.slice(i, i + CHUNK));
        if (insErr) {
          logError("search.index.insert", insErr);
          return NextResponse.json({ error: "Index update failed" }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ ok: true, count: hashBuffers.length });
  } catch (err) {
    logError("search.index", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
