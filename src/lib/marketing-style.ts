/**
 * Shared design tokens for the marketing pages (landing, about).
 * Keeps section widths, paddings, and heading styles aligned across
 * every page in the `(marketing)` route group so nothing visually
 * jumps between them.
 */

export const SECTION_MAX = 1200;
export const MOCKUP_MAX = 1400;
export const SECTION_PAD_Y = 96;
export const GREEN = "#04a45c";

export const EYEBROW_STYLE: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  fontFamily: "var(--font-geist-mono), monospace",
  textTransform: "uppercase",
  letterSpacing: 2,
  color: "rgba(255,255,255,0.4)",
  marginBottom: 14,
};

export const H2_STYLE: React.CSSProperties = {
  fontSize: "clamp(28px, 3.5vw, 40px)",
  fontWeight: 700,
  color: "white",
  letterSpacing: -1.2,
  lineHeight: 1.12,
  margin: 0,
  // Balance line breaks across every row so headings don't leave a
  // single lonely word on the last line. Modern browsers (Chrome
  // 114+, Firefox 121+, Safari 17.5+). Falls back gracefully to
  // normal wrapping on older browsers.
  textWrap: "balance",
};
