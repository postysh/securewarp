/**
 * Client-side PDF generator for the 24-word recovery phrase. Runs
 * entirely in the browser — the phrase never touches the server, same
 * zero-knowledge invariant as the sessionStorage key material.
 *
 * Lazy-imported from recovery-key-modal.tsx so pdf-lib (~150 KB) only
 * loads when the user actually hits the download button, keeping it
 * off the signup critical path.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

interface RecoveryPdfInput {
  recoveryKey: string;
  email?: string;
}

// Brand orange (coral) lifted from src/app/icon.svg — the one used on
// the marketing nav brand mark + accent chevrons.
const BRAND_ORANGE = rgb(0xef / 255, 0x5a / 255, 0x3c / 255);

// Brand mark paths lifted verbatim from src/app/icon.svg (viewBox
// 115 140 145 100). Three stacked chevrons — rendered in white with
// varying opacity on the orange band so the layered silhouette
// stays readable.
const LOGO_PATHS = [
  "M 228.265625 154.761719 L 168.773438 214.253906 L 180.21875 225.703125 C 183.457031 228.9375 188.699219 228.9375 191.933594 225.703125 L 251.425781 166.210938 L 239.980469 154.761719 C 236.742188 151.527344 231.5 151.527344 228.265625 154.761719 Z",
  "M 181.859375 154.964844 L 145.671875 191.152344 L 162.976562 208.457031 L 205.019531 166.410156 L 193.574219 154.964844 C 190.339844 151.726562 185.09375 151.726562 181.859375 154.964844 Z",
  "M 140.488281 150.132812 L 124.757812 165.859375 C 123.546875 167.070312 123.546875 169.03125 124.757812 170.238281 L 139.875 185.355469 L 163.648438 161.582031 L 152.199219 150.132812 C 148.964844 146.898438 143.722656 146.898438 140.488281 150.132812 Z",
];
const LOGO_OPACITIES = [1.0, 0.72, 0.48];
const LOGO_VB_X = 115;
const LOGO_VB_Y = 140;
const LOGO_VB_W = 145;
const LOGO_VB_H = 100;
const AMBER_BG = rgb(0xff / 255, 0xf6 / 255, 0xe8 / 255);
const AMBER_BORDER = rgb(0xf0 / 255, 0xc0 / 255, 0x70 / 255);
const INK = rgb(0.12, 0.12, 0.12);
const INK_MUTED = rgb(0.42, 0.42, 0.42);
const INK_SOFT = rgb(0.62, 0.62, 0.62);
const CARD_BG = rgb(0.98, 0.97, 0.95);
const DIVIDER = rgb(0.9, 0.88, 0.85);

export async function generateRecoveryPdf({ recoveryKey, email }: RecoveryPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("SecureWarp Recovery Phrase");
  pdf.setAuthor("SecureWarp");
  pdf.setProducer("SecureWarp");
  pdf.setCreator("SecureWarp");

  const page = pdf.addPage([612, 792]); // US Letter
  const { width, height } = page.getSize();

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const courierBold = await pdf.embedFont(StandardFonts.CourierBold);
  const courier = await pdf.embedFont(StandardFonts.Courier);

  const MARGIN = 48;

  // ─── Orange brand band ───────────────────────────────────────────
  const BAND_H = 88;
  page.drawRectangle({
    x: 0,
    y: height - BAND_H,
    width,
    height: BAND_H,
    color: BRAND_ORANGE,
  });

  // Logo + wordmark centered as a single horizontal group. Wordmark
  // uses manual char-draw because pdf-lib's drawText has no
  // letter-spacing option; we want the tracked-out caps to match the
  // brand treatment on the marketing site.
  const logoScale = 0.42;
  const logoW = LOGO_VB_W * logoScale;
  const logoH = LOGO_VB_H * logoScale;

  const wordmark = "SECUREWARP";
  const wordmarkSize = 18;
  const wordmarkCharWidth = courierBold.widthOfTextAtSize("M", wordmarkSize);
  const wordmarkSpacing = wordmarkCharWidth * 0.35;
  const wordmarkTotal =
    wordmark.length * wordmarkCharWidth + (wordmark.length - 1) * wordmarkSpacing;

  const logoWordmarkGap = 14;
  const groupTotal = logoW + logoWordmarkGap + wordmarkTotal;
  const groupStartX = (width - groupTotal) / 2;
  const bandMidY = height - BAND_H / 2;

  // drawSvgPath transform: SVG (sx, sy) → pdf (sx*scale + x, -sy*scale + y).
  // To place the path's visible top-left (LOGO_VB_X, LOGO_VB_Y) at
  // (groupStartX, bandMidY + logoH/2), solve for x and y.
  const logoDrawX = groupStartX - LOGO_VB_X * logoScale;
  const logoDrawY = bandMidY + logoH / 2 + LOGO_VB_Y * logoScale;
  for (let i = 0; i < LOGO_PATHS.length; i++) {
    page.drawSvgPath(LOGO_PATHS[i], {
      x: logoDrawX,
      y: logoDrawY,
      scale: logoScale,
      color: rgb(1, 1, 1),
      opacity: LOGO_OPACITIES[i],
    });
  }

  let cursorX = groupStartX + logoW + logoWordmarkGap;
  const wordmarkY = bandMidY - wordmarkSize / 2 + 4;
  for (const ch of wordmark) {
    page.drawText(ch, {
      x: cursorX,
      y: wordmarkY,
      size: wordmarkSize,
      font: courierBold,
      color: rgb(1, 1, 1),
    });
    cursorX += wordmarkCharWidth + wordmarkSpacing;
  }

  // ─── Title + subtitle ────────────────────────────────────────────
  let y = height - BAND_H - 40;
  page.drawText("Recovery Phrase", {
    x: MARGIN,
    y,
    size: 24,
    font: helvBold,
    color: INK,
  });

  y -= 22;
  page.drawText("24 words. The only way back if you lose your password.", {
    x: MARGIN,
    y,
    size: 11,
    font: helv,
    color: INK_MUTED,
  });

  // ─── Warning card ────────────────────────────────────────────────
  y -= 28;
  const warnH = 58;
  page.drawRectangle({
    x: MARGIN,
    y: y - warnH,
    width: width - MARGIN * 2,
    height: warnH,
    color: AMBER_BG,
    borderColor: AMBER_BORDER,
    borderWidth: 0.5,
  });

  page.drawText("Store this offline. We cannot reset it.", {
    x: MARGIN + 16,
    y: y - 22,
    size: 11,
    font: helvBold,
    color: INK,
  });

  page.drawText(
    "Anyone with these 24 words can decrypt your files. Keep this document private.",
    {
      x: MARGIN + 16,
      y: y - 40,
      size: 10,
      font: helv,
      color: INK_MUTED,
    }
  );

  y -= warnH + 28;

  // ─── 24-word grid ────────────────────────────────────────────────
  // 4 rows × 6 cols. Each cell numbered, monospace for readability.
  const words = recoveryKey.trim().split(/\s+/);
  const cols = 6;
  const rows = Math.ceil(words.length / cols);
  const gridW = width - MARGIN * 2;
  const cellW = gridW / cols;
  const cellH = 26;
  const gridH = rows * cellH + 16;

  page.drawRectangle({
    x: MARGIN,
    y: y - gridH,
    width: gridW,
    height: gridH,
    color: CARD_BG,
    borderColor: DIVIDER,
    borderWidth: 0.5,
  });

  const gridTop = y - 18;
  for (let i = 0; i < words.length; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const cx = MARGIN + col * cellW + 12;
    const cy = gridTop - row * cellH;
    const num = String(i + 1).padStart(2, "0");
    page.drawText(num, {
      x: cx,
      y: cy,
      size: 8,
      font: courier,
      color: INK_SOFT,
    });
    page.drawText(words[i] ?? "", {
      x: cx + 20,
      y: cy,
      size: 11,
      font: courierBold,
      color: INK,
    });
  }

  y -= gridH + 24;

  // ─── Metadata ────────────────────────────────────────────────────
  const generatedIso = new Date().toISOString().slice(0, 10);

  page.drawText("Account", {
    x: MARGIN,
    y,
    size: 9,
    font: helvBold,
    color: INK_SOFT,
  });
  page.drawText(email ?? "Not provided", {
    x: MARGIN + 64,
    y,
    size: 10,
    font: courier,
    color: INK,
  });

  y -= 16;
  page.drawText("Generated", {
    x: MARGIN,
    y,
    size: 9,
    font: helvBold,
    color: INK_SOFT,
  });
  page.drawText(generatedIso, {
    x: MARGIN + 64,
    y,
    size: 10,
    font: courier,
    color: INK,
  });

  y -= 22;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: width - MARGIN, y },
    thickness: 0.5,
    color: DIVIDER,
  });

  // ─── Recovery instructions ───────────────────────────────────────
  y -= 22;
  page.drawText("How to recover your account", {
    x: MARGIN,
    y,
    size: 12,
    font: helvBold,
    color: INK,
  });

  y -= 18;
  const steps = [
    "1.  Go to securewarp.com and choose Sign in.",
    "2.  Click \"Recover with recovery key\" under the sign-in form.",
    "3.  Enter your email, then paste all 24 words in order.",
    "4.  Choose a new password. Your files decrypt automatically.",
  ];
  for (const step of steps) {
    page.drawText(step, {
      x: MARGIN,
      y,
      size: 10.5,
      font: helv,
      color: INK_MUTED,
    });
    y -= 15;
  }

  // ─── Footer ──────────────────────────────────────────────────────
  page.drawText(
    "This document contains sensitive key material. Do not share or store it online in cleartext.",
    {
      x: MARGIN,
      y: 40,
      size: 8.5,
      font: helv,
      color: INK_SOFT,
    }
  );

  return await pdf.save();
}
