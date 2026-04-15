/**
 * Client-side tokenizer for the encrypted search index.
 *
 * Inputs (filename, file content text) are normalized, split, and
 * expanded into the set of tokens we'll HMAC and ship to the server.
 * Two token kinds are produced per word, both with a 1-byte prefix
 * before the HMAC input so they share no namespace:
 *
 *   `w:<word>`    — exact whole-word match (used for high-precision
 *                   queries; very small index)
 *   `g:<trigram>` — sliding 3-character windows of each word, which
 *                   gives substring + prefix matching for a modest
 *                   index inflation (~3-5x vs whole-word only)
 *
 * Anything shorter than 3 chars produces no trigrams (only the whole-
 * word token), so single- and two-letter words still match exactly.
 *
 * Determinism: the same input always tokenizes to the same set, since
 * the HMAC step happens later in `hash-token.ts` and is deterministic
 * given the user's `searchIndexKey`.
 */

// Tiny English stopword list. Kept short on purpose — every word
// dropped here is a query that won't match. This is the minimal set
// of high-frequency words that would otherwise dominate the index
// and slow lookups for queries that include them.
const STOPWORDS = new Set([
  "a", "an", "and", "or", "the", "of", "to", "in", "on", "at",
  "is", "it", "for", "with", "by",
]);

const MIN_WORD_LEN = 1;
// Cap per-file content tokens to keep storage bounded. This is the
// upper bound on UNIQUE tokens produced from one file (deduped Set).
// Filename tokens are tiny and not subject to this cap.
const MAX_CONTENT_TOKENS_PER_FILE = 5000;
// Cap how many characters of body content we tokenize. A 200-page
// document is ~100k chars; longer files get truncated rather than
// blowing up the index.
const MAX_CONTENT_CHARS = 100_000;

/**
 * Strip diacritics and lowercase. NFKC normalization first so
 * compatibility characters (e.g. fullwidth Latin) map to their
 * ASCII equivalents before stripping.
 */
function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    // Decompose then drop combining marks → strips accents.
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Split normalized text into words. Splits on anything that isn't a
 * letter or number — punctuation, dots, dashes, AND underscores all
 * become separators. File extensions split off cleanly
 * ("report.q4.pdf" → ["report", "q4", "pdf"]) and snake_case names
 * like "Q4_Report_2024" split into their parts so each is searchable.
 */
function splitWords(s: string): string[] {
  return s.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= MIN_WORD_LEN);
}

/**
 * Produce trigrams for a single word. A word of length n yields
 * (n - 2) trigrams. Words shorter than 3 chars yield none.
 */
function trigrams(word: string): string[] {
  if (word.length < 3) return [];
  const out: string[] = [];
  for (let i = 0; i <= word.length - 3; i++) {
    out.push(word.slice(i, i + 3));
  }
  return out;
}

/** Tokens are returned with their kind prefix already attached. */
export type Token = string;

function expand(words: string[], out: Set<Token>, cap: number): void {
  for (const word of words) {
    if (out.size >= cap) return;
    if (STOPWORDS.has(word)) continue;
    out.add(`w:${word}`);
    for (const tri of trigrams(word)) {
      if (out.size >= cap) return;
      out.add(`g:${tri}`);
    }
  }
}

/**
 * Tokens produced from a filename only. Always indexed; no cap because
 * filenames are short.
 */
export function tokenizeFilename(name: string): Token[] {
  const out = new Set<Token>();
  const normalized = normalize(name);
  expand(splitWords(normalized), out, Number.POSITIVE_INFINITY);
  return Array.from(out);
}

/**
 * Tokens produced from a filename plus body text content. Body text
 * is truncated to `MAX_CONTENT_CHARS` and the unique-token set is
 * capped at `MAX_CONTENT_TOKENS_PER_FILE` to bound index size.
 */
export function tokenizeFile(name: string, content: string | null): Token[] {
  const out = new Set<Token>();
  expand(splitWords(normalize(name)), out, Number.POSITIVE_INFINITY);
  if (content) {
    const truncated =
      content.length > MAX_CONTENT_CHARS ? content.slice(0, MAX_CONTENT_CHARS) : content;
    expand(splitWords(normalize(truncated)), out, MAX_CONTENT_TOKENS_PER_FILE);
  }
  return Array.from(out);
}

/**
 * Tokens for a search query. Uses the same tokenizer so the hashes
 * computed at query time match the hashes stored at index time.
 *
 * Returns an empty list for an empty query — callers should short-
 * circuit on empty (no need to send a server roundtrip).
 */
export function tokenizeQuery(query: string): Token[] {
  const out = new Set<Token>();
  const normalized = normalize(query);
  expand(splitWords(normalized), out, Number.POSITIVE_INFINITY);
  return Array.from(out);
}
