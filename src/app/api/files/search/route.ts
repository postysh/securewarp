import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { supabase } from "@/lib/db/supabase";
import { logError } from "@/lib/log";

/**
 * Match search-token hashes against the caller's encrypted index.
 *
 * Body: `{ tokens: base64[] }` — one HMAC-SHA256 hash per query
 * token, computed client-side under the user's `searchIndexKey`.
 *
 * Response: `{ fileIds: string[] }` — files where ALL of the supplied
 * tokens appear in the user's index. (AND-semantics: typing "budget
 * 2024" returns files whose tokens include both `w:budget` and
 * `w:2024` — narrower than OR, much more useful.)
 *
 * The server never sees plaintext queries or filenames; it only joins
 * opaque hashes against opaque hashes.
 */

const REQ_SCHEMA = z.object({
  tokens: z.array(z.string()).min(1).max(40),
});

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
    const { tokens } = parsed.data;

    const hashHex: string[] = [];
    for (const t of tokens) {
      const buf = parseTokenHash(t);
      if (!buf) {
        return NextResponse.json({ error: "Malformed token" }, { status: 400 });
      }
      hashHex.push("\\x" + buf.toString("hex"));
    }

    // For an AND query we need files that match every token. The
    // straightforward path: fetch (file_id, token_hash) rows for all
    // requested hashes, then count distinct hashes per file in JS and
    // keep those with `count === tokens.length`.
    //
    // This works without an extra DB function and uses the existing
    // composite index. For very large indices we'd push this down
    // into a `HAVING COUNT(DISTINCT token_hash) = N` SQL function;
    // not worth it until the index is in the millions of rows.
    const { data, error } = await supabase
      .from("file_search_tokens")
      .select("file_id, token_hash")
      .eq("user_id", session.userId)
      .in("token_hash", hashHex);

    if (error) {
      logError("search.query", error);
      return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }

    // Group hits by file. PostgREST returns bytea as `\xhex...` strings;
    // we store the same form in `hashHex` so direct equality works.
    const required = hashHex.length;
    const fileTokenSets = new Map<string, Set<string>>();
    for (const row of data ?? []) {
      const hex = String(row.token_hash);
      let set = fileTokenSets.get(row.file_id);
      if (!set) {
        set = new Set();
        fileTokenSets.set(row.file_id, set);
      }
      set.add(hex);
    }

    const fileIds: string[] = [];
    for (const [fileId, hits] of fileTokenSets) {
      // AND semantics: every requested hash must be present.
      if (hits.size >= required) fileIds.push(fileId);
    }

    return NextResponse.json({ fileIds });
  } catch (err) {
    logError("search.query", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
