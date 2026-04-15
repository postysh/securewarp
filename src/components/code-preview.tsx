"use client";

import { useEffect, useState } from "react";

/**
 * Syntax-highlighted text preview.
 *
 * Detects the language from the filename extension and lazy-loads
 * highlight.js (the common-language bundle, ~250 KB gzipped) on first
 * use. Falls back to a plain `<pre>` for anything not on the language
 * map or while the highlighter is loading.
 *
 * Zero-knowledge / CSP notes:
 *
 *   - highlight.js runs entirely client-side. No network calls, no
 *     eval, no WASM. The bundle is fetched as a regular JS chunk
 *     (already covered by `script-src 'self'` on the main app).
 *   - `hljs.highlight()` HTML-escapes the original text before
 *     wrapping tokens in `<span class="hljs-…">`. The output is safe
 *     to render via `dangerouslySetInnerHTML`. We do NOT pass user
 *     input through any other path that could re-interpret it.
 *   - Theme styles are inlined below — no external stylesheet, no
 *     extra `style-src` allowance needed.
 */

// Extension → highlight.js language id. Keep this list aligned with
// the text MIMEs allowlisted in mime-safety.ts. Anything not mapped
// renders as plain text, which is still readable via the `<pre>`
// fallback path.
const EXT_TO_LANG: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  ps1: "powershell",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  xml: "xml",
  html: "xml",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  sql: "sql",
  dockerfile: "dockerfile",
  makefile: "makefile",
  diff: "diff",
  patch: "diff",
};

function detectLanguage(filename: string): string | null {
  const lower = filename.toLowerCase();
  // Special-case extensionless filenames
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "makefile";
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = lower.slice(dot + 1);
  return EXT_TO_LANG[ext] ?? null;
}

// Cached highlighter instance to avoid re-importing on every render.
let hljsPromise: Promise<typeof import("highlight.js").default> | null = null;
function loadHljs() {
  if (!hljsPromise) {
    hljsPromise = import("highlight.js").then((m) => m.default);
  }
  return hljsPromise;
}

interface Props {
  text: string;
  filename: string;
}

export function CodePreview({ text, filename }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const language = detectLanguage(filename);

  useEffect(() => {
    if (!language) return;
    let cancelled = false;
    loadHljs()
      .then((hljs) => {
        if (cancelled) return;
        if (!hljs.getLanguage(language)) {
          // Bundle didn't include this language; fall back to plain.
          return;
        }
        try {
          const result = hljs.highlight(text, { language, ignoreIllegals: true });
          if (!cancelled) setHtml(result.value);
        } catch {
          // Highlight failed for any reason — leave plaintext fallback.
        }
      })
      .catch(() => {
        // Dynamic import failed (offline, chunk 404, etc.) — fall back.
      });
    return () => {
      cancelled = true;
    };
  }, [text, language]);

  return (
    <div className="w-[90vw] max-w-[800px] max-h-[85vh] overflow-auto rounded-lg bg-[#1a1a2e] p-6">
      <pre className="text-[13px] text-white/80 font-mono whitespace-pre-wrap break-words leading-relaxed">
        {html ? (
          <code
            className={`hljs language-${language}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          text
        )}
      </pre>
    </div>
  );
}

// Inline GitHub-dark-ish theme for highlight.js token classes. Inlined
// rather than imported as a stylesheet so we don't broaden style-src
// or add a network dependency.
const HLJS_THEME_CSS = `
.hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-section, .hljs-title,
.hljs-meta, .hljs-doctag { color: #f97583; }
.hljs-string, .hljs-attr, .hljs-template-tag, .hljs-template-variable,
.hljs-addition, .hljs-symbol, .hljs-bullet { color: #9ecbff; }
.hljs-number, .hljs-literal, .hljs-built_in, .hljs-builtin-name,
.hljs-type { color: #79b8ff; }
.hljs-name, .hljs-tag, .hljs-attribute, .hljs-variable { color: #b392f0; }
.hljs-function, .hljs-class .hljs-title, .hljs-title.function_ { color: #b392f0; }
.hljs-deletion { color: #fdaeb7; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }
`;

if (typeof document !== "undefined") {
  const id = "hljs-theme-inline";
  if (!document.getElementById(id)) {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = HLJS_THEME_CSS;
    document.head.appendChild(style);
  }
}
