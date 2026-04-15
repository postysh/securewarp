/**
 * Text extraction for the encrypted search index.
 *
 * Called at upload time so the plaintext bytes are available exactly
 * once, tokenized, then discarded. Returns null for non-text files —
 * the indexer then indexes only the filename.
 *
 * We accept a file as "text" if EITHER:
 *   - its MIME type is on the preview allowlist's text set, OR
 *   - its filename extension is in KNOWN_TEXT_EXTENSIONS.
 *
 * The extension fallback exists because many files (especially code
 * files) arrive with empty/generic MIME types after platform quirks
 * (Windows SMB copy, drag from an IDE, etc.). Without it we'd miss
 * indexing common developer content.
 *
 * Size cap: we read at most `MAX_BYTES` of the file. Above that, the
 * file-body indexer silently skips content (filename still indexed).
 * Chosen to handle typical docs/code (a 200-page novel is ~1 MB) while
 * preventing a 2 GB "text" file from exploding the browser.
 */

import { isTextPreviewMime } from "@/lib/mime-safety";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const KNOWN_TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "log", "csv", "tsv",
  "json", "yaml", "yml", "toml", "ini", "conf", "cfg", "env",
  "xml", "html", "htm", "svg",
  "js", "mjs", "cjs", "jsx", "ts", "tsx",
  "py", "rb", "rs", "go", "java", "kt", "swift",
  "c", "h", "cpp", "cc", "hpp", "cs",
  "sh", "bash", "zsh", "fish", "ps1",
  "css", "scss", "sass", "less",
  "sql", "diff", "patch",
  "dockerfile", "makefile",
]);

function extensionOf(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.endsWith("/dockerfile")) return "dockerfile";
  if (lower === "makefile" || lower.endsWith("/makefile")) return "makefile";
  const dot = lower.lastIndexOf(".");
  if (dot === -1 || dot === lower.length - 1) return null;
  return lower.slice(dot + 1);
}

export function isLikelyTextFile(mime: string, name: string): boolean {
  if (isTextPreviewMime(mime)) return true;
  const ext = extensionOf(name);
  return ext !== null && KNOWN_TEXT_EXTENSIONS.has(ext);
}

/**
 * Returns plaintext UTF-8 content for indexable text files, or null
 * for anything else (or anything over the size cap). Caller must be
 * ready to drop the returned string after passing it to the tokenizer.
 */
export async function readTextForIndex(file: File): Promise<string | null> {
  if (!isLikelyTextFile(file.type || "", file.name)) return null;
  if (file.size > MAX_BYTES) return null;
  try {
    // `File.text()` decodes as UTF-8. Non-UTF-8 files decode to
    // replacement chars — still tokenizable (we'll just skip bad
    // bytes). No throwing path for encoding errors.
    return await file.text();
  } catch {
    return null;
  }
}
