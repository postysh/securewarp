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

import { isTextPreviewMime, isDocxMime, isXlsxMime } from "@/lib/mime-safety";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

// Office docs are heavier to parse (mammoth/exceljs each ~1 MB of JS
// and allocate intermediate ArrayBuffers during decode). Cap the raw
// file size higher than plain text (10 MB) since Office wrapping
// inflates word-count-to-byte ratio, but still bound it so a
// pathological 500 MB .xlsx doesn't freeze the tab.
const MAX_OFFICE_BYTES = 10 * 1024 * 1024;

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
 * Returns plaintext content suitable for the search tokenizer, or
 * null if the file isn't indexable or exceeds its size cap.
 *
 * Three paths:
 *   1. Plain-text / code → File.text() (UTF-8 decode, cheapest)
 *   2. .docx → mammoth.extractRawText (lazy-loaded, ~500 KB JS)
 *   3. .xlsx → exceljs workbook read → flatten cell values (lazy,
 *       ~1 MB JS)
 *
 * Office libs are only imported when actually needed so text uploads
 * don't pay the bundle cost. Both libs already ship because of the
 * preview viewer — no new deps.
 *
 * Caller must drop the returned string after passing it to the
 * tokenizer. The string is plaintext user content and shares the same
 * lifetime rules as the upload's session key.
 */
export async function readTextForIndex(file: File): Promise<string | null> {
  const mime = file.type || "";

  // Plain text / code files.
  if (isLikelyTextFile(mime, file.name)) {
    if (file.size > MAX_BYTES) return null;
    try {
      return await file.text();
    } catch {
      return null;
    }
  }

  // Office documents. Parse on a fresh ArrayBuffer so `file.arrayBuffer()`
  // (which can return SharedArrayBuffer in some contexts) doesn't fight
  // the libs' typings.
  if (isDocxMime(mime) || isXlsxMime(mime)) {
    if (file.size > MAX_OFFICE_BYTES) return null;
    try {
      const raw = await file.arrayBuffer();
      const copy = new Uint8Array(raw.byteLength);
      copy.set(new Uint8Array(raw));
      try {
        if (isDocxMime(mime)) return await extractDocx(copy.buffer as ArrayBuffer);
        return await extractXlsx(copy.buffer as ArrayBuffer);
      } finally {
        // Zero the typed-array view of the plaintext after parsing.
        // The Blob/File object keeps its own copy the browser can reach
        // via arrayBuffer() again; we can't reach that — this just
        // clears every view we control.
        try { copy.fill(0); } catch { /* detached */ }
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function extractDocx(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

async function extractXlsx(buffer: ArrayBuffer): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  // Flatten every cell's string representation. Sheet and cell
  // structure are discarded — the tokenizer doesn't care about 2D
  // layout, just the bag of words.
  const parts: string[] = [];
  workbook.eachSheet((sheet) => {
    parts.push(sheet.name);
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        parts.push(cellToString(cell.value));
      });
    });
  });
  return parts.join(" ");
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.text === "string") return v.text;
    if (typeof v.result === "string") return v.result;
    if (typeof v.result === "number") return String(v.result);
    if (Array.isArray(v.richText)) {
      return v.richText
        .map((rt) =>
          typeof rt === "object" && rt && "text" in rt
            ? String((rt as { text: unknown }).text)
            : "",
        )
        .join("");
    }
  }
  return String(value);
}
