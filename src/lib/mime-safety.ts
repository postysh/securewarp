/**
 * Defense-in-depth MIME allowlist for file preview.
 *
 * The server never sees plaintext MIME types — `meta.type` is inside
 * the encrypted metadata blob, supplied by whoever uploaded the file.
 * A malicious uploader could set it to anything (`text/html`,
 * `application/xhtml+xml`, etc.) and the preview pipeline would
 * happily hand those bytes to the browser with that MIME.
 *
 * Browsers treat blob-URL content as same-origin. A blob with type
 * `text/html` opened in an iframe or via `window.open` runs as
 * securewarp.com's origin — can read sessionStorage, call our APIs,
 * and bypass parts of the CSP that don't yet use nonces.
 *
 * The preview-time rules:
 *   - Preview-as-text (rendered in <pre>{...}</pre>): safe for any
 *     text/* because React escapes children. Still, we pass
 *     `text/plain` into the Blob so if a text preview is ever opened
 *     directly (window.open on the blob URL) it renders as text, not
 *     interpreted HTML.
 *   - Preview-as-image/video/audio/pdf: MIME must be on the
 *     PREVIEWABLE_MIME set. Unknown → use application/octet-stream
 *     so the browser treats it as a binary download, never an inline
 *     render.
 *   - Downloads of files that are never previewed inline: always fall
 *     through to application/octet-stream so any accidental
 *     window.open won't render them.
 *
 * If you add a new preview type, add its MIME here AND add the render
 * path in file-preview.tsx. Don't widen this set just because a new
 * MIME shows up — every entry is a trust declaration about how
 * browsers parse that bytes-with-type combination.
 */

const PREVIEWABLE_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/bmp",
  // SVG is safe ONLY when rendered via <img src> or as a CSS
  // background. Every major browser blocks <script> elements and
  // external resource fetches inside SVG loaded this way — it's a
  // browser-level invariant, not something we enforce. If a preview
  // branch ever inlines SVG as DOM (innerHTML / dangerouslySetInnerHTML
  // / parseFromString + adoptNode), scripts WILL execute. Don't do
  // that. See AGENTS.md → "File-preview safety".
  "image/svg+xml",
]);

const PREVIEWABLE_VIDEO_MIMES = new Set([
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
]);

const PREVIEWABLE_AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
  "audio/flac",
  "audio/aac",
  "audio/x-m4a",
]);

const PREVIEWABLE_TEXT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/x-log",
  "text/x-python",
  "text/x-java",
  "text/x-c",
  "text/x-c++",
  "text/x-ruby",
  "text/x-rust",
  "text/x-go",
  "application/json",
  "application/xml",
  "text/xml",
  "text/javascript",
  "application/javascript",
  "text/typescript",
  "application/typescript",
  "text/css",
  "text/yaml",
  "application/yaml",
  // Deliberately NOT included: text/html, application/xhtml+xml —
  // these are treated as documents by every browser. The text-preview
  // panel renders via <pre>{...}</pre> which escapes them, but the
  // Blob's declared type should never be text/html regardless.
]);

// Office document MIMEs. Rendered exclusively on the isolated viewer
// subdomain so a malicious .docx/.xlsx that exploits the renderer
// cannot reach main-app cookies or storage.
//
// Intentionally NOT on this list (and why):
//   - application/msword (.doc)             — legacy binary CFB; only
//     pure-client lib (`mammoth-doc`) is unmaintained and brittle.
//   - application/vnd.ms-excel (.xls)       — same story, legacy BIFF.
//   - application/vnd.openxmlformats-officedocument.presentationml.presentation
//     (.pptx)                               — no pure-client renderer
//     produces output close to the original; would mislead users.
//   - application/vnd.ms-powerpoint (.ppt)  — legacy binary, same issues.
//   - application/rtf (.rtf)                — pure-client RTF renderers
//     are rare and security-audited even more rarely.
//
// Don't add any of these without (a) finding a maintained, audited
// pure-client renderer that runs under the viewer's CSP, and
// (b) adding an isolated /viewer/<type> route mirroring the docx
// and xlsx pattern. Server-side rendering is not an option — it
// would break zero-knowledge.
const PREVIEWABLE_DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PREVIEWABLE_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const PREVIEWABLE_OFFICE_MIMES = new Set([
  PREVIEWABLE_DOCX_MIME,
  PREVIEWABLE_XLSX_MIME,
]);

/** True for Office document MIMEs rendered on the isolated viewer. */
export function isOfficeMime(mime: string): boolean {
  return PREVIEWABLE_OFFICE_MIMES.has(mime);
}

/** True for .docx specifically. */
export function isDocxMime(mime: string): boolean {
  return mime === PREVIEWABLE_DOCX_MIME;
}

/** True for .xlsx specifically. */
export function isXlsxMime(mime: string): boolean {
  return mime === PREVIEWABLE_XLSX_MIME;
}

/** MIME types we are willing to preview inline in the browser. */
export function isPreviewableMime(mime: string): boolean {
  return (
    PREVIEWABLE_IMAGE_MIMES.has(mime) ||
    PREVIEWABLE_VIDEO_MIMES.has(mime) ||
    PREVIEWABLE_AUDIO_MIMES.has(mime) ||
    PREVIEWABLE_TEXT_MIMES.has(mime) ||
    PREVIEWABLE_OFFICE_MIMES.has(mime) ||
    mime === "application/pdf"
  );
}

/** True for any text preview (rendered via <pre>, not blob). */
export function isTextPreviewMime(mime: string): boolean {
  return PREVIEWABLE_TEXT_MIMES.has(mime);
}

/**
 * Sanitize a client-supplied MIME before putting it in a Blob that
 * the browser will render. For previewable types we keep the MIME as
 * declared; for anything else we return `application/octet-stream`
 * which forces any direct navigation to download rather than render.
 *
 * For text previews, we always rewrite to `text/plain` even if the
 * original was `text/html` — the bytes are shown via React's text
 * escaping anyway, and the Blob's declared type must not invite a
 * browser to interpret it.
 */
export function safeMimeForBlob(mime: string): string {
  if (isTextPreviewMime(mime)) return "text/plain";
  if (isPreviewableMime(mime)) return mime;
  return "application/octet-stream";
}

/**
 * Sanitize the MIME for a download Blob. Downloads never render
 * inline — we always want the browser to treat them as a binary blob
 * the user just saves to disk. Using octet-stream removes the
 * possibility that a user's `window.open(blobUrl)` on a download link
 * accidentally opens a rendered document.
 */
export function safeMimeForDownload(_mime: string): string {
  return "application/octet-stream";
}
